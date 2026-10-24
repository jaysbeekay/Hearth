import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser, setModuleEnabled } from "../helpers/testDb";
import {
  createVehicleCommand,
  updateVehicleCommand,
  deleteVehicleCommand,
  restoreVehicleCommand,
  permanentlyDeleteVehicleCommand,
  createServiceRecordCommand,
  updateServiceRecordCommand,
  deleteServiceRecordCommand,
  restoreServiceRecordCommand,
  permanentlyDeleteServiceRecordCommand,
} from "@/lib/commands/vehicles";
import { RecordNotFoundError, StaleEditError } from "@/lib/commands/shared";
import { ModuleDisabledError } from "@/lib/modules/enablement";
import { clearNotificationLogs } from "@/lib/notifications/logs";
import { revalidatePath } from "next/cache";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/notifications/logs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications/logs")>();
  return { ...actual, clearNotificationLogs: vi.fn(actual.clearNotificationLogs) };
});

const db = setupTestDb();

let actorId: string;

beforeEach(async () => {
  vi.clearAllMocks();
  actorId = (await createTestUser()).id;
  await setModuleEnabled("VEHICLES", true);
});

async function exists(p: string) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// Puts a file where storage.ts keeps a Service record's Documents, plus the
// row pointing at it, so permanent delete has something real to clean up.
async function attachFile(vehicleItemId: string) {
  const dir = path.join(db.uploadsDir, "vehicle-items", vehicleItemId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "stored.pdf"), "%PDF-1.4 test");
  await db.prisma.vehicleItemDocument.create({
    data: { vehicleItemId, filename: "invoice.pdf", storedName: "stored.pdf", mimeType: "application/pdf", size: 13 },
  });
  return dir;
}

describe("Vehicle commands", () => {
  it("creates a Vehicle with the actor as creator and revalidates the list", async () => {
    const vehicle = await createVehicleCommand({ label: "Family car", make: "Toyota" }, actorId);
    const row = await db.prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(row).toMatchObject({ label: "Family car", make: "Toyota", createdById: actorId });
    expect(revalidatePath).toHaveBeenCalledWith("/vehicles");
  });

  it("applies a partial patch, leaving other fields alone", async () => {
    const vehicle = await createVehicleCommand({ label: "Ute", make: "Ford", model: "Ranger" }, actorId);
    const editor = await createTestUser();
    await updateVehicleCommand(vehicle.id, { model: "Everest" }, editor.id);
    const row = await db.prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(row).toMatchObject({ label: "Ute", make: "Ford", model: "Everest", updatedById: editor.id });
    expect(revalidatePath).toHaveBeenCalledWith(`/vehicles/${vehicle.id}`);
  });

  it("soft deletes to Trash and restores", async () => {
    const vehicle = await createVehicleCommand({ label: "Old bike" }, actorId);
    await deleteVehicleCommand(vehicle.id);
    expect((await db.prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).deletedAt).toBeInstanceOf(Date);
    expect(revalidatePath).toHaveBeenCalledWith("/settings/trash");

    await restoreVehicleCommand(vehicle.id);
    expect((await db.prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).deletedAt).toBeNull();
  });

  it("permanently deletes the Vehicle, its Service records, their files and its Reminder log", async () => {
    const vehicle = await createVehicleCommand({ label: "Wagon" }, actorId);
    const item = await createServiceRecordCommand(vehicle.id, { type: "SERVICE", title: "Logbook service", currency: "AUD" });
    const dir = await attachFile(item.id);
    await db.prisma.notificationLog.create({
      data: { ownerType: "VEHICLE", ownerId: vehicle.id, field: "regoExpiry", channel: "EMAIL", thresholdDays: 30 },
    });

    await permanentlyDeleteVehicleCommand(vehicle.id);

    expect(await db.prisma.vehicle.findUnique({ where: { id: vehicle.id } })).toBeNull();
    expect(await db.prisma.vehicleItem.findUnique({ where: { id: item.id } })).toBeNull();
    expect(await db.prisma.vehicleItemDocument.count()).toBe(0);
    expect(await db.prisma.notificationLog.count({ where: { ownerId: vehicle.id } })).toBe(0);
    expect(await exists(dir)).toBe(false);
  });

  it("changing rego doesn't reset the sent-Reminder log (ADR 0003)", async () => {
    const vehicle = await createVehicleCommand(
      { label: "Hatch", regoExpiry: new Date("2026-11-01T00:00:00Z") },
      actorId,
    );
    await db.prisma.notificationLog.create({
      data: { ownerType: "VEHICLE", ownerId: vehicle.id, field: "regoExpiry", channel: "EMAIL", thresholdDays: 30 },
    });

    const renewed = new Date("2027-11-01T00:00:00Z");
    await updateVehicleCommand(vehicle.id, { regoExpiry: renewed }, actorId);

    const row = await db.prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(row.regoExpiry?.toISOString()).toBe(renewed.toISOString());
    expect(clearNotificationLogs).not.toHaveBeenCalled();
    expect(await db.prisma.notificationLog.count({ where: { ownerId: vehicle.id } })).toBe(1);
  });

  it("refuses a stale edit and accepts a current one", async () => {
    const vehicle = await createVehicleCommand({ label: "Van" }, actorId);
    const loadedAt = vehicle.updatedAt.toISOString();

    // Someone else edits first; updatedAt moves on.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await updateVehicleCommand(vehicle.id, { colour: "White" }, actorId);

    await expect(
      updateVehicleCommand(vehicle.id, { colour: "Blue" }, actorId, { baseUpdatedAt: loadedAt }),
    ).rejects.toBeInstanceOf(StaleEditError);
    expect((await db.prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).colour).toBe("White");

    const current = await db.prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
    await updateVehicleCommand(vehicle.id, { colour: "Blue" }, actorId, { baseUpdatedAt: current.updatedAt });
    expect((await db.prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).colour).toBe("Blue");
  });

  it("reports a missing Vehicle as not found", async () => {
    await expect(updateVehicleCommand("missing", { label: "x" }, actorId)).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(deleteVehicleCommand("missing")).rejects.toBeInstanceOf(RecordNotFoundError);
  });

  it("rejects every write when the Vehicles module is disabled", async () => {
    const vehicle = await createVehicleCommand({ label: "Sedan" }, actorId);
    const item = await createServiceRecordCommand(vehicle.id, { type: "REPAIR", title: "Brakes", currency: "AUD" });
    await setModuleEnabled("VEHICLES", false);

    const writes = [
      () => createVehicleCommand({ label: "Another" }, actorId),
      () => updateVehicleCommand(vehicle.id, { label: "Renamed" }, actorId),
      () => deleteVehicleCommand(vehicle.id),
      () => restoreVehicleCommand(vehicle.id),
      () => permanentlyDeleteVehicleCommand(vehicle.id),
      () => createServiceRecordCommand(vehicle.id, { type: "OTHER", title: "Wash", currency: "AUD" }),
      () => updateServiceRecordCommand(item.id, { title: "Renamed" }),
      () => deleteServiceRecordCommand(item.id),
      () => restoreServiceRecordCommand(item.id),
      () => permanentlyDeleteServiceRecordCommand(item.id),
    ];
    for (const write of writes) {
      await expect(write()).rejects.toBeInstanceOf(ModuleDisabledError);
    }
    expect(await db.prisma.vehicle.count()).toBe(1);
    expect((await db.prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).label).toBe("Sedan");
    expect(await db.prisma.vehicleItem.count()).toBe(1);
  });
});

describe("Service record commands", () => {
  let vehicleId: string;

  beforeEach(async () => {
    vehicleId = (await createVehicleCommand({ label: "Family car" }, actorId)).id;
  });

  it("creates a Service record on its Vehicle", async () => {
    const item = await createServiceRecordCommand(vehicleId, {
      type: "SERVICE",
      title: "60,000 km service",
      cost: 420,
      currency: "AUD",
    });
    expect(await db.prisma.vehicleItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({
      vehicleId,
      title: "60,000 km service",
      cost: 420,
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/vehicles/${vehicleId}`);
  });

  it("won't create a Service record on a missing Vehicle", async () => {
    await expect(
      createServiceRecordCommand("missing", { type: "SERVICE", title: "x", currency: "AUD" }),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
  });

  it("applies a partial patch and enforces the Vehicle scope", async () => {
    const item = await createServiceRecordCommand(vehicleId, { type: "REPAIR", title: "Tyres", provider: "Bob's", currency: "AUD" });
    await updateServiceRecordCommand(item.id, { cost: 800 }, { vehicleId });
    expect(await db.prisma.vehicleItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({
      title: "Tyres",
      provider: "Bob's",
      cost: 800,
    });

    const otherVehicle = await createVehicleCommand({ label: "Other" }, actorId);
    await expect(
      updateServiceRecordCommand(item.id, { cost: 1 }, { vehicleId: otherVehicle.id }),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(deleteServiceRecordCommand(item.id, { vehicleId: otherVehicle.id })).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
  });

  it("refuses a stale edit", async () => {
    const item = await createServiceRecordCommand(vehicleId, { type: "SERVICE", title: "Oil", currency: "AUD" });
    const loadedAt = item.updatedAt.toISOString();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await updateServiceRecordCommand(item.id, { title: "Oil and filter" });
    await expect(
      updateServiceRecordCommand(item.id, { title: "Oil only" }, { baseUpdatedAt: loadedAt }),
    ).rejects.toBeInstanceOf(StaleEditError);
  });

  it("soft deletes to Trash and restores", async () => {
    const item = await createServiceRecordCommand(vehicleId, { type: "ROADWORTHY", title: "RWC", currency: "AUD" });
    await deleteServiceRecordCommand(item.id, { vehicleId });
    expect((await db.prisma.vehicleItem.findUniqueOrThrow({ where: { id: item.id } })).deletedAt).toBeInstanceOf(Date);
    await restoreServiceRecordCommand(item.id);
    expect((await db.prisma.vehicleItem.findUniqueOrThrow({ where: { id: item.id } })).deletedAt).toBeNull();
  });

  it("permanently deletes the Service record with its Documents and files", async () => {
    const item = await createServiceRecordCommand(vehicleId, { type: "SERVICE", title: "Service", currency: "AUD" });
    const dir = await attachFile(item.id);

    await permanentlyDeleteServiceRecordCommand(item.id);

    expect(await db.prisma.vehicleItem.findUnique({ where: { id: item.id } })).toBeNull();
    expect(await db.prisma.vehicleItemDocument.count()).toBe(0);
    expect(await exists(dir)).toBe(false);
    expect(await db.prisma.vehicle.findUnique({ where: { id: vehicleId } })).not.toBeNull();
  });
});

// The offline sync handler goes through the same commands; no e2e spec
// replays a Vehicle op, so check the wiring here.
describe("sync entities for Vehicles", () => {
  it("creates, refuses a stale update, and soft deletes through the commands", async () => {
    const { ENTITY_SYNC_CONFIGS } = await import("@/app/api/sync/entityHandlers");
    const sync = ENTITY_SYNC_CONFIGS.vehicle;
    const { id } = await sync.create!({ label: "Synced car" }, { userId: actorId });
    const loaded = await db.prisma.vehicle.findUniqueOrThrow({ where: { id } });

    await new Promise((resolve) => setTimeout(resolve, 5));
    await sync.update!(id, { colour: "Red" }, { userId: actorId, baseUpdatedAt: loaded.updatedAt.toISOString() });
    await expect(
      sync.update!(id, { colour: "Green" }, { userId: actorId, baseUpdatedAt: loaded.updatedAt.toISOString() }),
    ).rejects.toThrow("changed elsewhere");

    const item = await ENTITY_SYNC_CONFIGS.vehicleItem.create!(
      { type: "SERVICE", title: "Offline service", currency: "AUD" },
      { userId: actorId, parentId: id },
    );
    expect((await db.prisma.vehicleItem.findUniqueOrThrow({ where: { id: item.id } })).vehicleId).toBe(id);

    await sync.remove!(id, { userId: actorId });
    const row = await db.prisma.vehicle.findUniqueOrThrow({ where: { id } });
    expect(row.colour).toBe("Red");
    expect(row.deletedAt).toBeInstanceOf(Date);
  });
});
