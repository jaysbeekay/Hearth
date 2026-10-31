import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser, setModuleEnabled } from "../helpers/testDb";
import {
  createVehicleCommand,
  updateVehicleCommand,
  archiveVehicleCommand,
  unarchiveVehicleCommand,
  deleteVehicleCommand,
  restoreVehicleCommand,
  createServiceRecordCommand,
} from "@/lib/commands/vehicles";
import {
  createPropertyCommand,
  createTenancyCommand,
  archivePropertyCommand,
  unarchivePropertyCommand,
  deletePropertyCommand,
  restorePropertyCommand,
} from "@/lib/commands/home";
import { createContractCommand } from "@/lib/commands/contracts";
import { RecordNotFoundError, StaleEditError } from "@/lib/commands/shared";
import { ModuleDisabledError } from "@/lib/modules/enablement";
import { contractSchema } from "@/lib/validation/contract";
import { propertySchema, rentalAgreementSchema } from "@/lib/validation/home";
import { runExpirationCheck } from "@/lib/notifications/scheduler";
import { getHouseholdReminderHealth } from "@/lib/notifications/health";
import { sendExpiryWebhooks } from "@/lib/notifications/webhook";
import { getCurrentTenancies, getCurrentTenancy } from "@/lib/tenancies";
import { queryProperties, queryVehicles, whatsDue } from "@/lib/domainQueries";
import { getCalendarEvents } from "@/lib/calendarEvents";
import { vehicleRules } from "@/lib/recordFilters";
import { revalidatePath } from "next/cache";
import type { ModuleKey } from "@/lib/modules/registry";

// #355 — Archive for Vehicles and Properties (the household no longer has
// them), against a real migrated database. Archive is not Trash: the record
// stays, but stops driving Due entries and Reminders.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/notifications/channels", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications/channels")>();
  return {
    ...actual,
    activeChannels: vi.fn(async () => ({
      email: false,
      ntfy: false,
      webhook: true,
      emailRecipients: [],
    })),
  };
});
vi.mock("@/lib/notifications/webhook", () => ({
  getEnabledWebhookEndpoints: vi.fn(async () => [{ id: "hook", url: "https://example.test/hook", secret: null, secretEncrypted: false }]),
  sendExpiryWebhooks: vi.fn(async () => undefined),
}));

const db = setupTestDb();
let actorId: string;

beforeEach(async () => {
  vi.clearAllMocks();
  actorId = (await createTestUser()).id;
  await setModuleEnabled("VEHICLES", true);
  await setModuleEnabled("HOME", true);
  await db.prisma.appSetting.create({ data: { key: "household.timezone", value: "UTC", updatedAt: new Date() } });
});

const at = (d: string) => new Date(`${d}T09:00:00Z`);
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const webhookSends = () => vi.mocked(sendExpiryWebhooks).mock.calls.length;

function daysFromNow(n: number) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

describe("archiveVehicleCommand", () => {
  it("sets and clears archivedAt, recording who did it, and revalidates the lists", async () => {
    const vehicle = await createVehicleCommand({ label: "Old ute" }, actorId);
    const other = await createTestUser();

    const archived = await archiveVehicleCommand(vehicle.id, other.id);
    expect(archived.archivedAt).toBeInstanceOf(Date);
    expect(archived.deletedAt).toBeNull();
    expect(archived.updatedById).toBe(other.id);
    expect(revalidatePath).toHaveBeenCalledWith("/vehicles");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(revalidatePath).toHaveBeenCalledWith(`/vehicles/${vehicle.id}`);

    const restored = await unarchiveVehicleCommand(vehicle.id, actorId);
    expect(restored.archivedAt).toBeNull();
    expect(restored.updatedById).toBe(actorId);
  });

  it("keeps the original date when archived twice, and unarchiving a live one is a no-op", async () => {
    const vehicle = await createVehicleCommand({ label: "Old ute" }, actorId);
    await unarchiveVehicleCommand(vehicle.id, actorId);
    const first = await archiveVehicleCommand(vehicle.id, actorId);
    const again = await archiveVehicleCommand(vehicle.id, actorId);
    expect(again.archivedAt).toEqual(first.archivedAt);
  });

  it("keeps Service records and their Documents", async () => {
    const vehicle = await createVehicleCommand({ label: "Old ute" }, actorId);
    const record = await createServiceRecordCommand(vehicle.id, { type: "SERVICE", title: "Log service", currency: "AUD" });
    await db.prisma.vehicleItemDocument.create({
      data: { vehicleItemId: record.id, filename: "invoice.pdf", storedName: "stored.pdf", mimeType: "application/pdf", size: 1 },
    });
    await archiveVehicleCommand(vehicle.id, actorId);
    expect(await db.prisma.vehicleItem.count({ where: { vehicleId: vehicle.id, deletedAt: null } })).toBe(1);
    expect(await db.prisma.vehicleItemDocument.count({ where: { vehicleItemId: record.id } })).toBe(1);
  });

  it("refuses a Vehicle in Trash or missing, as not found", async () => {
    const vehicle = await createVehicleCommand({ label: "Old ute" }, actorId);
    await deleteVehicleCommand(vehicle.id);
    await expect(archiveVehicleCommand(vehicle.id, actorId)).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(unarchiveVehicleCommand(vehicle.id, actorId)).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(archiveVehicleCommand("nope", actorId)).rejects.toBeInstanceOf(RecordNotFoundError);
  });

  it("survives Trash and restore: an Archived Vehicle restored from Trash is still Archived", async () => {
    const vehicle = await createVehicleCommand({ label: "Old ute" }, actorId);
    await archiveVehicleCommand(vehicle.id, actorId);
    await deleteVehicleCommand(vehicle.id);
    await restoreVehicleCommand(vehicle.id);
    const row = await db.prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(row.archivedAt).not.toBeNull();
    expect(row.deletedAt).toBeNull();
  });

  it("refuses a stale archive and an off module", async () => {
    const vehicle = await createVehicleCommand({ label: "Old ute" }, actorId);
    // An edit made from an earlier load of the Vehicle.
    const base = new Date(vehicle.updatedAt.getTime() - 60_000);
    await expect(archiveVehicleCommand(vehicle.id, actorId, { baseUpdatedAt: base })).rejects.toBeInstanceOf(StaleEditError);
    expect((await db.prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).archivedAt).toBeNull();
    await archiveVehicleCommand(vehicle.id, actorId, { baseUpdatedAt: vehicle.updatedAt });

    await setModuleEnabled("VEHICLES", false);
    await expect(archiveVehicleCommand(vehicle.id, actorId)).rejects.toBeInstanceOf(ModuleDisabledError);
    await expect(unarchiveVehicleCommand(vehicle.id, actorId)).rejects.toBeInstanceOf(ModuleDisabledError);
  });

  it("still lets an Archived Vehicle be edited", async () => {
    const vehicle = await createVehicleCommand({ label: "Old ute" }, actorId);
    await archiveVehicleCommand(vehicle.id, actorId);
    const edited = await updateVehicleCommand(vehicle.id, { notes: "Sold to Sam" }, actorId);
    expect(edited.notes).toBe("Sold to Sam");
    expect(edited.archivedAt).not.toBeNull();
  });
});

describe("archivePropertyCommand", () => {
  it("sets and clears archivedAt and revalidates", async () => {
    const property = await createPropertyCommand(propertySchema.parse({ label: "Beach Flat" }), actorId);
    const archived = await archivePropertyCommand(property.id, actorId);
    expect(archived.archivedAt).toBeInstanceOf(Date);
    expect(archived.updatedById).toBe(actorId);
    expect(revalidatePath).toHaveBeenCalledWith("/home");
    expect(revalidatePath).toHaveBeenCalledWith(`/home/${property.id}`);

    const first = archived.archivedAt;
    expect((await archivePropertyCommand(property.id, actorId)).archivedAt).toEqual(first);
    expect((await unarchivePropertyCommand(property.id, actorId)).archivedAt).toBeNull();
  });

  it("refuses a Property in Trash, a stale archive and an off module; Trash round trip keeps it Archived", async () => {
    const property = await createPropertyCommand(propertySchema.parse({ label: "Beach Flat" }), actorId);
    await archivePropertyCommand(property.id, actorId);
    await deletePropertyCommand(property.id);
    await expect(unarchivePropertyCommand(property.id, actorId)).rejects.toBeInstanceOf(RecordNotFoundError);
    await restorePropertyCommand(property.id);
    expect((await db.prisma.property.findUniqueOrThrow({ where: { id: property.id } })).archivedAt).not.toBeNull();

    await expect(
      unarchivePropertyCommand(property.id, actorId, { baseUpdatedAt: new Date("2020-01-01T00:00:00Z") }),
    ).rejects.toBeInstanceOf(StaleEditError);

    await setModuleEnabled("HOME", false);
    await expect(archivePropertyCommand(property.id, actorId)).rejects.toBeInstanceOf(ModuleDisabledError);
  });
});

describe("an Archived Vehicle stops driving Reminders", () => {
  it("sends none for it, resumes on restore, and leaves a linked Contract's own Reminders alone", async () => {
    const vehicle = await createVehicleCommand(
      { label: "Old ute", regoExpiry: day("2026-11-24"), reminderDaysBefore: "30,14,7,1" },
      actorId,
    );
    const contract = await createContractCommand(
      contractSchema.parse({
        title: "Ute insurance",
        category: "CAR_INSURANCE",
        provider: "Acme",
        renewalType: "MANUAL_RENEWAL",
        startDate: "2025-11-24",
        endDate: "2026-11-24",
        vehicleId: vehicle.id,
      }),
      actorId,
    );
    await archiveVehicleCommand(vehicle.id, actorId);

    await runExpirationCheck(at("2026-10-25"));
    const kinds = vi.mocked(sendExpiryWebhooks).mock.calls.map((c) => c[0]);
    // Only the Contract reminded: it is its own Due source.
    expect(kinds.map((k) => k.kind)).toEqual(["contract"]);
    expect(kinds[0]).toMatchObject({ id: contract.id });

    await unarchiveVehicleCommand(vehicle.id, actorId);
    await runExpirationCheck(at("2026-10-25"));
    expect(vi.mocked(sendExpiryWebhooks).mock.calls.map((c) => c[0].kind).sort()).toEqual(["contract", "vehicle"]);
  });

  it("leaves it out of the household Reminder roll-up", async () => {
    await createVehicleCommand({ label: "Old ute", regoExpiry: day("2026-11-24") }, actorId);
    const archived = await createVehicleCommand({ label: "Sold car", regoExpiry: day("2026-11-24") }, actorId);
    await archiveVehicleCommand(archived.id, actorId);
    const health = await getHouseholdReminderHealth();
    const labels = JSON.stringify(health);
    expect(labels).not.toContain("Sold car");
  });
});

describe("an Archived Property stops driving its Tenancy's Reminders", () => {
  async function rentedProperty(label: string, leaseEnd: string) {
    const property = await createPropertyCommand(propertySchema.parse({ label, occupancyStatus: "RENTED" }), actorId);
    const tenancy = await createTenancyCommand(
      property.id,
      rentalAgreementSchema.parse({ weeklyRent: 600, tenantName: "Sam Lee", leaseEnd }),
      actorId,
    );
    return { property, tenancy };
  }

  it("filters at the one point the scheduler and roll-up share, and resumes on restore", async () => {
    const { property, tenancy } = await rentedProperty("Beach Flat", "2026-11-24");
    await rentedProperty("City Unit", "2026-11-24");
    expect((await getCurrentTenancies()).map((t) => t.propertyLabel).sort()).toEqual(["Beach Flat", "City Unit"]);

    await archivePropertyCommand(property.id, actorId);
    expect((await getCurrentTenancies()).map((t) => t.propertyLabel)).toEqual(["City Unit"]);
    expect(await getCurrentTenancy(tenancy.id)).toBeNull();

    await runExpirationCheck(at("2026-10-25"));
    expect(webhookSends()).toBe(1);
    expect(vi.mocked(sendExpiryWebhooks).mock.calls[0][0]).toMatchObject({ title: "City Unit" });

    await unarchivePropertyCommand(property.id, actorId);
    expect((await getCurrentTenancy(tenancy.id))?.propertyId).toBe(property.id);
    await runExpirationCheck(at("2026-10-25"));
    expect(webhookSends()).toBe(2);
  });
});

describe("Archived records drop out of what's Due, Upcoming and the lists the Assistant reads", () => {
  it("whatsDue, queryVehicles, queryProperties and Upcoming leave them out", async () => {
    const soon = daysFromNow(10);
    const vehicle = await createVehicleCommand({ label: "Sold car", regoExpiry: soon }, actorId);
    const kept = await createVehicleCommand({ label: "Daily car", regoExpiry: soon }, actorId);
    const property = await createPropertyCommand(propertySchema.parse({ label: "Sold flat", occupancyStatus: "RENTED" }), actorId);
    await createTenancyCommand(
      property.id,
      rentalAgreementSchema.parse({ weeklyRent: 500, leaseEnd: soon.toISOString().slice(0, 10) }),
      actorId,
    );
    const modules = new Set<ModuleKey>(["VEHICLES", "HOME"]);

    expect((await whatsDue(modules)).map((i) => i.title).sort()).toEqual(["Daily car", "Sold car", "Sold flat"]);
    const upcomingTitles = async () =>
      (
        await getCalendarEvents(
          modules,
          { today: daysFromNow(0).toISOString().slice(0, 10), defaultReminderDays: "30,14,7,1" },
          daysFromNow(60).toISOString().slice(0, 10),
        )
      )
        .map((e) => e.title)
        .join("|");
    expect(await upcomingTitles()).toContain("Sold car");

    await archiveVehicleCommand(vehicle.id, actorId);
    await archivePropertyCommand(property.id, actorId);

    expect((await whatsDue(modules)).map((i) => i.title)).toEqual(["Daily car"]);
    expect((await queryVehicles()).map((v) => v.label)).toEqual(["Daily car"]);
    expect(await queryProperties()).toEqual([]);
    const upcoming = await upcomingTitles();
    expect(upcoming).not.toContain("Sold car");
    expect(upcoming).not.toContain("Sold flat");
    expect(upcoming).toContain("Daily car");
    expect(kept.id).toBeTruthy();
  });

  it("an Archived Vehicle is never missing key details", async () => {
    const vehicle = await createVehicleCommand({ label: "No ids" }, actorId);
    expect(await db.prisma.vehicle.count({ where: vehicleRules.missingDetails.where })).toBe(1);
    await archiveVehicleCommand(vehicle.id, actorId);
    expect(await db.prisma.vehicle.count({ where: vehicleRules.missingDetails.where })).toBe(0);
    const row = await db.prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(vehicleRules.missingDetails.matches(row)).toBe(false);
  });
});
