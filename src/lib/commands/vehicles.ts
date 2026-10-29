import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { removeOwnerDocumentFiles } from "@/lib/commands/documents";
import { clearNotificationLogs } from "@/lib/notifications/logs";
import { assertModuleEnabled } from "@/lib/modules/enablement";
import {
  updateLiveUnlessStale,
  findLiveParent,
  requireLive,
  assertParentRestored,
  RecordNotFoundError,
  type UpdateOptions,
} from "@/lib/commands/shared";
import type { ClearablePatch } from "@/lib/validation/fullFormUpdate";
import type { VehicleInput, VehicleItemInput } from "@/lib/validation/vehicles";
import type { Prisma } from "@/generated/prisma/client";

// Record commands for Vehicles and Service records (#389, ADR 0003). Every
// write to `vehicle` / `vehicleItem` goes through here: server actions, the
// offline sync handler and Trash retention. Callers own sign-in, role checks
// and Zod parsing; these own the module gate, the write, file cleanup and
// revalidation.
//
// A Vehicle in Trash is read-only until it's restored, and so are its
// Service records (#428, the rules in shared.ts): an update to it, or a
// create or update under it, is refused as not found, and a Service record
// can't be restored while its Vehicle is still in Trash. Updates carry that
// rule in their guarded write; creates and restores check and write in one
// transaction, so a move to Trash can't land in between.
//
// Per ADR 0003, a date change (rego, insurance, next service) does not clear
// the sent-Reminder log. clearNotificationLogs is only for permanent delete.

// ── Vehicle ─────────────────────────────────────────────────────────────────

function revalidateVehicleLists() {
  revalidatePath("/vehicles");
  revalidatePath("/dashboard");
}

// The global client, or a transaction's `tx` (which must then be used for
// every query inside it).
type Db = Prisma.TransactionClient;

function loadVehicle(id: string, db: Db = prisma) {
  return db.vehicle.findUnique({ where: { id } });
}

// For delete, restore and the row an update returns: Trash or not.
async function findVehicle(id: string) {
  const vehicle = await loadVehicle(id);
  if (!vehicle) throw new RecordNotFoundError("Vehicle");
  return vehicle;
}

// For a write to a Vehicle or under it, as `what`: one in Trash counts as
// not found.
function findLiveVehicle(id: string, what = "Vehicle", db: Db = prisma) {
  return findLiveParent(loadVehicle(id, db), what);
}

export async function createVehicleCommand(input: VehicleInput, actorId: string) {
  await assertModuleEnabled("VEHICLES");
  const vehicle = await prisma.vehicle.create({ data: { ...input, createdById: actorId } });
  revalidateVehicleLists();
  return vehicle;
}

// Partial patch: keys left out (or undefined) are not written, and a `null`
// clears the field. A full edit form sends fullFormUpdate()'s patch, where
// every field it submitted blank is `null` (#413).
export async function updateVehicleCommand(
  id: string,
  patch: ClearablePatch<VehicleInput>,
  actorId: string,
  options: UpdateOptions = {},
) {
  await assertModuleEnabled("VEHICLES");
  await updateLiveUnlessStale(
    options.baseUpdatedAt,
    (guard) =>
      prisma.vehicle.updateMany({
        where: { id, deletedAt: null, ...guard },
        data: { ...patch, updatedById: actorId },
      }),
    () => findLiveVehicle(id),
  );
  revalidateVehicleLists();
  revalidatePath(`/vehicles/${id}`);
  return findVehicle(id);
}

// #287 — soft delete: moves the Vehicle to Trash. Its Service records and
// their files stay intact so restoreVehicleCommand brings it back as it was.
export async function deleteVehicleCommand(id: string) {
  await assertModuleEnabled("VEHICLES");
  await findVehicle(id);
  await prisma.vehicle.update({ where: { id }, data: { deletedAt: new Date() } });
  revalidateVehicleLists();
  revalidatePath("/settings/trash");
}

export async function restoreVehicleCommand(id: string) {
  await assertModuleEnabled("VEHICLES");
  await findVehicle(id);
  await prisma.vehicle.update({ where: { id }, data: { deletedAt: null } });
  revalidateVehicleLists();
  revalidatePath(`/vehicles/${id}`);
  revalidatePath("/settings/trash");
}

export async function permanentlyDeleteVehicleCommand(id: string) {
  await assertModuleEnabled("VEHICLES");
  await purgeVehicle(id);
  revalidateVehicleLists();
  revalidatePath("/settings/trash");
}

// The row-and-files part of a permanent delete, with no module gate and no
// revalidation. Only for Trash retention (src/lib/trash.ts), which runs from
// a page render (where revalidatePath can't be called) and from the
// scheduler, and purges expired records whether or not the module is on.
export async function purgeVehicle(id: string) {
  const existing = await prisma.vehicle.findUnique({
    where: { id },
    include: { items: { select: { id: true } } },
  });
  if (!existing) throw new RecordNotFoundError("Vehicle");
  // The row delete cascades to Service records and their Document rows;
  // their files on disk aren't FK-linked, so they're removed here.
  await prisma.vehicle.delete({ where: { id } });
  // Files straight after the row: if clearing the log below throws, the
  // files mustn't be left orphaned with no row pointing at them (#413).
  for (const item of existing.items) {
    await removeOwnerDocumentFiles("VEHICLE_ITEM", item.id);
  }
  // NotificationLog is polymorphic (#201), so no cascade: clear it explicitly.
  await clearNotificationLogs("VEHICLE", id);
}

// ── Service record (VehicleItem) ────────────────────────────────────────────

export interface ServiceRecordScope {
  // When given, the Service record must belong to this Vehicle, otherwise
  // it's reported as not found (the URL-scoped check the forms rely on).
  vehicleId?: string;
}

async function findServiceRecord(id: string, scope: ServiceRecordScope = {}, db: Db = prisma) {
  const item = await db.vehicleItem.findUnique({ where: { id } });
  if (!item || (scope.vehicleId !== undefined && item.vehicleId !== scope.vehicleId)) {
    throw new RecordNotFoundError("Service record");
  }
  return item;
}

export async function createServiceRecordCommand(vehicleId: string, input: VehicleItemInput) {
  await assertModuleEnabled("VEHICLES");
  const item = await prisma.$transaction(async (tx) => {
    await findLiveVehicle(vehicleId, "Vehicle", tx);
    return tx.vehicleItem.create({ data: { ...input, vehicleId } });
  });
  revalidatePath(`/vehicles/${vehicleId}`);
  return item;
}

// Partial patch, as for updateVehicleCommand.
export async function updateServiceRecordCommand(
  id: string,
  patch: ClearablePatch<VehicleItemInput>,
  options: UpdateOptions & ServiceRecordScope = {},
) {
  await assertModuleEnabled("VEHICLES");
  await updateLiveUnlessStale(
    options.baseUpdatedAt,
    (guard) =>
      prisma.vehicleItem.updateMany({
        where: { id, vehicleId: options.vehicleId, deletedAt: null, vehicle: { deletedAt: null }, ...guard },
        data: patch,
      }),
    async () => {
      const existing = requireLive(await findServiceRecord(id, options), "Service record");
      await findLiveVehicle(existing.vehicleId, "Service record");
    },
  );
  const item = await findServiceRecord(id);
  revalidatePath(`/vehicles/${item.vehicleId}`);
  return item;
}

export async function deleteServiceRecordCommand(id: string, scope: ServiceRecordScope = {}) {
  await assertModuleEnabled("VEHICLES");
  const existing = await findServiceRecord(id, scope);
  await prisma.vehicleItem.update({ where: { id }, data: { deletedAt: new Date() } });
  revalidatePath(`/vehicles/${existing.vehicleId}`);
  revalidatePath("/settings/trash");
}

export async function restoreServiceRecordCommand(id: string) {
  await assertModuleEnabled("VEHICLES");
  const existing = await prisma.$transaction(async (tx) => {
    const item = await findServiceRecord(id, {}, tx);
    assertParentRestored(
      await tx.vehicle.findUnique({ where: { id: item.vehicleId }, select: { deletedAt: true } }),
      "Vehicle",
    );
    await tx.vehicleItem.update({ where: { id }, data: { deletedAt: null } });
    return item;
  });
  revalidatePath(`/vehicles/${existing.vehicleId}`);
  revalidatePath("/settings/trash");
}

export async function permanentlyDeleteServiceRecordCommand(id: string) {
  await assertModuleEnabled("VEHICLES");
  const { vehicleId } = await purgeServiceRecord(id);
  revalidatePath(`/vehicles/${vehicleId}`);
  revalidatePath("/settings/trash");
}

// See purgeVehicle: for Trash retention only.
export async function purgeServiceRecord(id: string) {
  const existing = await findServiceRecord(id);
  // Cascades to the Service record's Document rows; then the files go.
  await prisma.vehicleItem.delete({ where: { id } });
  await removeOwnerDocumentFiles("VEHICLE_ITEM", id);
  return { vehicleId: existing.vehicleId };
}
