import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { removeOwnerDocumentFiles } from "@/lib/commands/documents";
import { clearNotificationLogs } from "@/lib/notifications/logs";
import { assertModuleEnabled } from "@/lib/modules/enablement";
import { updateUnlessStale, RecordNotFoundError, type UpdateOptions } from "@/lib/commands/shared";
import type { ClearablePatch } from "@/lib/validation/fullFormUpdate";
import type { VehicleInput, VehicleItemInput } from "@/lib/validation/vehicles";

// Record commands for Vehicles and Service records (#389, ADR 0003). Every
// write to `vehicle` / `vehicleItem` goes through here: server actions, the
// offline sync handler and Trash retention. Callers own sign-in, role checks
// and Zod parsing; these own the module gate, the write, file cleanup and
// revalidation.
//
// Per ADR 0003, a date change (rego, insurance, next service) does not clear
// the sent-Reminder log. clearNotificationLogs is only for permanent delete.

// ── Vehicle ─────────────────────────────────────────────────────────────────

function revalidateVehicleLists() {
  revalidatePath("/vehicles");
  revalidatePath("/dashboard");
}

async function findVehicle(id: string) {
  const vehicle = await prisma.vehicle.findUnique({ where: { id } });
  if (!vehicle) throw new RecordNotFoundError("Vehicle");
  return vehicle;
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
  await findVehicle(id);
  await updateUnlessStale(options.baseUpdatedAt, (guard) =>
    prisma.vehicle.updateMany({ where: { id, ...guard }, data: { ...patch, updatedById: actorId } }),
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

async function findServiceRecord(id: string, scope: ServiceRecordScope = {}) {
  const item = await prisma.vehicleItem.findUnique({ where: { id } });
  if (!item || (scope.vehicleId !== undefined && item.vehicleId !== scope.vehicleId)) {
    throw new RecordNotFoundError("Service record");
  }
  return item;
}

export async function createServiceRecordCommand(vehicleId: string, input: VehicleItemInput) {
  await assertModuleEnabled("VEHICLES");
  await findVehicle(vehicleId);
  const item = await prisma.vehicleItem.create({ data: { ...input, vehicleId } });
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
  const existing = await findServiceRecord(id, options);
  await updateUnlessStale(options.baseUpdatedAt, (guard) =>
    prisma.vehicleItem.updateMany({ where: { id, ...guard }, data: patch }),
  );
  revalidatePath(`/vehicles/${existing.vehicleId}`);
  return findServiceRecord(id);
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
  const existing = await findServiceRecord(id);
  await prisma.vehicleItem.update({ where: { id }, data: { deletedAt: null } });
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
