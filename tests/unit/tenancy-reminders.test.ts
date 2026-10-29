import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser, setModuleEnabled } from "../helpers/testDb";
import {
  createPropertyCommand,
  createTenancyCommand,
  updateTenancyCommand,
  permanentlyDeleteTenancyCommand,
  permanentlyDeletePropertyCommand,
  deletePropertyCommand,
} from "@/lib/commands/home";
import { propertySchema, rentalAgreementSchema } from "@/lib/validation/home";
import { runExpirationCheck } from "@/lib/notifications/scheduler";
import { getReminderHealth, getHouseholdReminderHealth } from "@/lib/notifications/health";
import { sendReminderEmail } from "@/lib/notifications/email";
import { sendNtfyReminder } from "@/lib/notifications/ntfy";
import { sendExpiryWebhooks } from "@/lib/notifications/webhook";
import { addDays, householdDay } from "@/lib/duePolicy";

// #388 — Reminders for a Tenancy's lease end, against a real migrated
// database: the scheduler, the per-record health card on the Property and
// the household roll-up all read the same Reminder schedule.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
// Every channel configured, each with a sender we can count.
vi.mock("@/lib/notifications/channels", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications/channels")>();
  return {
    ...actual,
    activeChannels: vi.fn(async () => ({
      email: true,
      ntfy: true,
      webhook: true,
      emailRecipients: [{ email: "owner@example.test", dateFormat: null }],
    })),
  };
});
vi.mock("@/lib/notifications/email", () => ({ sendReminderEmail: vi.fn(async () => undefined) }));
vi.mock("@/lib/notifications/ntfy", () => ({ sendNtfyReminder: vi.fn(async () => undefined) }));
vi.mock("@/lib/notifications/webhook", () => ({
  getEnabledWebhookEndpoints: vi.fn(async () => [{ id: "hook", url: "https://example.test/hook", secret: null, secretEncrypted: false }]),
  sendExpiryWebhooks: vi.fn(async () => undefined),
}));

const db = setupTestDb();
let actorId: string;

beforeEach(async () => {
  vi.mocked(sendReminderEmail).mockClear();
  vi.mocked(sendNtfyReminder).mockClear();
  vi.mocked(sendExpiryWebhooks).mockReset();
  vi.mocked(sendExpiryWebhooks).mockResolvedValue(undefined);
  actorId = (await createTestUser()).id;
  await setModuleEnabled("HOME", true);
  await db.prisma.appSetting.create({ data: { key: "household.timezone", value: "UTC", updatedAt: new Date() } });
});

const at = (d: string) => new Date(`${d}T09:00:00Z`);

async function rentedProperty(lease: Record<string, unknown>, label = "Beach Flat") {
  const property = await createPropertyCommand(propertySchema.parse({ label, occupancyStatus: "RENTED" }), actorId);
  const tenancy = await createTenancyCommand(
    property.id,
    rentalAgreementSchema.parse({ weeklyRent: 600, tenantName: "Sam Lee", ...lease }),
    actorId,
  );
  return { property, tenancy };
}

const sends = () => ({
  email: vi.mocked(sendReminderEmail).mock.calls.length,
  ntfy: vi.mocked(sendNtfyReminder).mock.calls.length,
  webhook: vi.mocked(sendExpiryWebhooks).mock.calls.length,
});

describe("the lease form's Reminder thresholds", () => {
  const parse = (reminderDaysBefore: unknown) =>
    rentalAgreementSchema.safeParse({ weeklyRent: "600", reminderDaysBefore });

  it("takes a comma-separated list of days", () => {
    expect(parse(" 60, 30 ,7").data?.reminderDaysBefore).toBe("60, 30 ,7");
  });

  it("treats blank as the household default", () => {
    expect(parse("").data?.reminderDaysBefore).toBeUndefined();
    expect(parse(null).data?.reminderDaysBefore).toBeUndefined();
  });

  it("rejects anything that isn't a list of non-negative numbers", () => {
    expect(parse("soon").success).toBe(false);
    expect(parse("30,-1").success).toBe(false);
    expect(parse("30,,7").success).toBe(false);
  });
});

describe("the scheduler", () => {
  it("sends one Reminder per channel for a lease end 30 days out, at the default thresholds", async () => {
    const { property, tenancy } = await rentedProperty({ leaseEnd: "2026-11-24" });

    await runExpirationCheck(at("2026-10-25"));
    expect(sends()).toEqual({ email: 1, ntfy: 1, webhook: 1 });
    expect(vi.mocked(sendExpiryWebhooks).mock.calls[0][0]).toMatchObject({
      kind: "tenancy",
      id: tenancy.id,
      propertyId: property.id,
      title: "Beach Flat",
      detail: "Sam Lee",
      daysRemaining: 30,
      endDate: new Date("2026-11-24T00:00:00.000Z"),
    });
    const logs = await db.prisma.notificationLog.findMany({ where: { ownerType: "TENANCY", ownerId: tenancy.id } });
    expect(logs.map((l) => [l.channel, l.field, l.thresholdDays, l.status]).sort()).toEqual([
      ["EMAIL", "leaseEnd", 30, "SENT"],
      ["NTFY", "leaseEnd", 30, "SENT"],
      ["WEBHOOK", "leaseEnd", 30, "SENT"],
    ]);

    // Not again on the next check.
    await runExpirationCheck(at("2026-10-26"));
    expect(sends()).toEqual({ email: 1, ntfy: 1, webhook: 1 });
    // The 14-day Reminder goes when it's crossed.
    await runExpirationCheck(at("2026-11-10"));
    expect(sends()).toEqual({ email: 2, ntfy: 2, webhook: 2 });
  });

  it("re-arms when the lease end moves, with no reset (ADR 0003)", async () => {
    const { tenancy } = await rentedProperty({ leaseEnd: "2026-11-24" });
    await runExpirationCheck(at("2026-10-25"));
    expect(sends().webhook).toBe(1);

    await updateTenancyCommand(tenancy.id, { leaseEnd: new Date("2026-11-25T00:00:00Z") });
    await runExpirationCheck(at("2026-10-26"));
    expect(sends().webhook).toBe(2);
  });

  it("uses the Tenancy's own thresholds", async () => {
    await rentedProperty({ leaseEnd: "2026-12-24", reminderDaysBefore: "60" });
    await runExpirationCheck(at("2026-10-25"));
    expect(vi.mocked(sendExpiryWebhooks).mock.calls[0][0]).toMatchObject({ kind: "tenancy", daysRemaining: 60 });
  });

  it("only reminds about the current Tenancy, of a rented Property, with the Home module on", async () => {
    const { property } = await rentedProperty({ leaseStart: "2026-01-01", leaseEnd: "2026-11-24" });
    // An older lease is history, even though its end is ahead too.
    await createTenancyCommand(
      property.id,
      rentalAgreementSchema.parse({ weeklyRent: 500, leaseStart: "2025-01-01", leaseEnd: "2026-11-20" }),
      actorId,
    );
    await runExpirationCheck(at("2026-10-25"));
    expect(sends().webhook).toBe(1);
    expect(vi.mocked(sendExpiryWebhooks).mock.calls[0][0]).toMatchObject({ endDate: new Date("2026-11-24T00:00:00Z") });

    const other = await rentedProperty({ leaseEnd: "2026-11-24" }, "City Unit");
    await deletePropertyCommand(other.property.id);
    await setModuleEnabled("HOME", false);
    await runExpirationCheck(at("2026-11-10"));
    expect(sends().webhook).toBe(1);

    await setModuleEnabled("HOME", true);
    await runExpirationCheck(at("2026-11-10"));
    // Only Beach Flat's 14-day Reminder: City Unit is in Trash.
    expect(sends().webhook).toBe(2);
  });

  it("sends nothing once the lease end has passed", async () => {
    await rentedProperty({ leaseEnd: "2026-10-20" });
    await runExpirationCheck(at("2026-10-25"));
    expect(sends()).toEqual({ email: 0, ntfy: 0, webhook: 0 });
  });
});

describe("permanent delete clears the Tenancy's sent log", () => {
  it("deleting the Tenancy", async () => {
    const { property, tenancy } = await rentedProperty({ leaseEnd: "2026-11-24" });
    await runExpirationCheck(at("2026-10-25"));
    expect(await db.prisma.notificationLog.count({ where: { ownerId: tenancy.id } })).toBe(3);

    await permanentlyDeleteTenancyCommand(tenancy.id, { propertyId: property.id });
    expect(await db.prisma.notificationLog.count({ where: { ownerId: tenancy.id } })).toBe(0);
  });

  it("deleting its Property", async () => {
    const { property, tenancy } = await rentedProperty({ leaseEnd: "2026-11-24" });
    await runExpirationCheck(at("2026-10-25"));

    await permanentlyDeletePropertyCommand(property.id);
    expect(await db.prisma.notificationLog.count({ where: { ownerId: tenancy.id } })).toBe(0);
  });
});

describe("Reminder health", () => {
  // getReminderHealth reads the real clock, so the dates follow today.
  const today = householdDay(new Date(), "UTC");

  it("the Property's card shows the lease's next Reminder", async () => {
    const leaseEnd = addDays(today, 40);
    const { tenancy } = await rentedProperty({ leaseEnd });
    const health = await getReminderHealth({
      ownerType: "TENANCY",
      ownerId: tenancy.id,
      record: { kind: "tenancy", ...tenancy },
    });
    expect(health.enabled).toBe(true);
    expect(health.thresholds).toEqual([1, 7, 14, 30]);
    expect(health.nextReminder).toEqual({ kind: "on", date: new Date(`${addDays(leaseEnd, -30)}T00:00:00.000Z`) });
  });

  it("a catch-up shows as the next check", async () => {
    const { tenancy } = await rentedProperty({ leaseEnd: addDays(today, 10) });
    const health = await getReminderHealth({
      ownerType: "TENANCY",
      ownerId: tenancy.id,
      record: { kind: "tenancy", ...tenancy },
    });
    expect(health.nextReminder).toEqual({ kind: "next-check" });
  });

  it("the household roll-up lists a lease whose last delivery failed", async () => {
    const { property } = await rentedProperty({ leaseEnd: addDays(today, 10) });
    vi.mocked(sendExpiryWebhooks).mockRejectedValue(new Error("webhook down"));
    await runExpirationCheck(new Date());

    const household = await getHouseholdReminderHealth();
    expect(household.uncovered).toEqual([
      {
        ownerType: "TENANCY",
        title: "Beach Flat — Lease",
        href: `/home/${property.id}`,
        reason: "Last delivery attempt failed",
      },
    ]);
  });
});
