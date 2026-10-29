import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { removeOwnerDocumentFiles } from "@/lib/commands/documents";
import { clearNotificationLogs } from "@/lib/notifications/logs";
import { assertModuleEnabled } from "@/lib/modules/enablement";
import {
  updateUnlessStale,
  findLiveParent,
  requireLive,
  assertParentRestored,
  RecordNotFoundError,
  type UpdateOptions,
} from "@/lib/commands/shared";
import type { ClearablePatch } from "@/lib/validation/fullFormUpdate";
import type {
  PropertyInput,
  HomeItemInput,
  RentalAgreementInput,
  RentalStatementInput,
} from "@/lib/validation/home";
import type { PropertyValuationInput } from "@/lib/validation/wealth";

// Record commands for the Property module (#390, ADR 0003): Properties,
// Maintenance records (`homeItem`), Tenancies (`rentalAgreement`), Rental
// statements and Property valuations. Every write to those tables goes
// through here: server actions, the offline sync handler and Trash
// retention. Callers own sign-in, role checks and Zod parsing; these own
// the HOME module gate, the write, file cleanup and revalidation.
//
// Only Properties and Maintenance records have a Trash (a `deletedAt`
// column). A Tenancy, a Rental statement and a Property valuation are
// deleted for good straight away, as they always have been. A Tenancy has
// no `updatedAt` column, so its updates take no stale-edit check.
//
// A record in Trash is read-only until it's restored: a create or update
// under a Property in Trash, or to a Maintenance record in Trash, is
// refused as not found, as the pages already 404 them. Delete, restore and
// permanent delete still work on it, but a Maintenance record can't be
// restored while its Property is still in Trash (#428, the rules in
// shared.ts).
//
// No Property-module record has Reminders yet, so nothing here touches the
// sent-Reminder log (Tenancy Reminders are #388).

// ── Property ────────────────────────────────────────────────────────────────

function revalidatePropertyLists() {
  revalidatePath("/home");
}

async function findProperty(id: string) {
  const property = await prisma.property.findUnique({ where: { id } });
  if (!property) throw new RecordNotFoundError("Property");
  return property;
}

// For writes to a Property or under it, as `what`: one in Trash counts as
// not found.
function findLiveProperty(id: string, what = "Property") {
  return findLiveParent(prisma.property.findUnique({ where: { id } }), what);
}

export async function createPropertyCommand(input: PropertyInput, actorId: string) {
  await assertModuleEnabled("HOME");
  const property = await prisma.property.create({ data: { ...input, createdById: actorId } });
  revalidatePropertyLists();
  return property;
}

// Partial patch: keys left out (or undefined) are not written, and a `null`
// clears the field. A full edit form sends fullFormUpdate()'s patch, where
// every field it submitted blank is `null` (#413).
export async function updatePropertyCommand(
  id: string,
  patch: ClearablePatch<PropertyInput>,
  actorId: string,
  options: UpdateOptions = {},
) {
  await assertModuleEnabled("HOME");
  await findLiveProperty(id);
  await updateUnlessStale(options.baseUpdatedAt, (guard) =>
    prisma.property.updateMany({ where: { id, ...guard }, data: { ...patch, updatedById: actorId } }),
  );
  revalidatePropertyLists();
  revalidatePath(`/home/${id}`);
  return findProperty(id);
}

// Turns rental tracking (the Rental tab) on or off for a Property.
export async function setPropertyRentedCommand(id: string, isRented: boolean, actorId: string) {
  await assertModuleEnabled("HOME");
  await findLiveProperty(id);
  await prisma.property.update({ where: { id }, data: { isRented, updatedById: actorId } });
  revalidatePath(`/home/${id}`);
  revalidatePath(`/home/${id}/rental`);
}

// #287 — soft delete: moves the Property to Trash. Everything under it stays
// intact so restorePropertyCommand brings it back as it was.
export async function deletePropertyCommand(id: string) {
  await assertModuleEnabled("HOME");
  await findProperty(id);
  await prisma.property.update({ where: { id }, data: { deletedAt: new Date() } });
  revalidatePropertyLists();
  revalidatePath("/settings/trash");
}

export async function restorePropertyCommand(id: string) {
  await assertModuleEnabled("HOME");
  await findProperty(id);
  await prisma.property.update({ where: { id }, data: { deletedAt: null } });
  revalidatePropertyLists();
  revalidatePath(`/home/${id}`);
  revalidatePath("/settings/trash");
}

export async function permanentlyDeletePropertyCommand(id: string) {
  await assertModuleEnabled("HOME");
  await purgeProperty(id);
  revalidatePropertyLists();
  revalidatePath("/settings/trash");
}

// The row-and-files part of a permanent delete, with no module gate and no
// revalidation. Only for Trash retention (src/lib/trash.ts), which runs from
// a page render (where revalidatePath can't be called) and from the
// scheduler, and purges expired records whether or not the module is on.
export async function purgeProperty(id: string) {
  const existing = await prisma.property.findUnique({
    where: { id },
    include: {
      items: { select: { id: true } },
      rentalAgreements: { select: { id: true } },
      rentalStatements: { select: { id: true } },
    },
  });
  if (!existing) throw new RecordNotFoundError("Property");
  // The row delete cascades to Maintenance records, Tenancies, Rental
  // statements, valuations and their Document rows (linked Contracts and
  // Products are unlinked, not deleted). The files on disk aren't FK-linked,
  // so they're removed straight after.
  await prisma.property.delete({ where: { id } });
  // The sent-Reminder log isn't FK-linked either (#388).
  for (const agreement of existing.rentalAgreements) {
    await clearNotificationLogs("TENANCY", agreement.id);
  }
  for (const item of existing.items) {
    await removeOwnerDocumentFiles("HOME_ITEM", item.id);
  }
  for (const statement of existing.rentalStatements) {
    await removeOwnerDocumentFiles("RENTAL_STATEMENT", statement.id);
  }
}

// Records under a Property: when `propertyId` is given, the record must
// belong to that Property, otherwise it's reported as not found (the
// URL-scoped check the forms rely on).
export interface PropertyScope {
  propertyId?: string;
}

function inScope(record: { propertyId: string } | null, scope: PropertyScope) {
  return record !== null && (scope.propertyId === undefined || record.propertyId === scope.propertyId);
}

// ── Maintenance record (HomeItem) ───────────────────────────────────────────

async function findMaintenanceRecord(id: string, scope: PropertyScope = {}) {
  const item = await prisma.homeItem.findUnique({ where: { id } });
  if (!item || !inScope(item, scope)) throw new RecordNotFoundError("Maintenance record");
  return item;
}

export async function createMaintenanceRecordCommand(propertyId: string, input: HomeItemInput) {
  await assertModuleEnabled("HOME");
  await findLiveProperty(propertyId);
  const item = await prisma.homeItem.create({ data: { ...input, propertyId } });
  revalidatePath(`/home/${propertyId}`);
  return item;
}

// Partial patch, as for updatePropertyCommand.
export async function updateMaintenanceRecordCommand(
  id: string,
  patch: ClearablePatch<HomeItemInput>,
  options: UpdateOptions & PropertyScope = {},
) {
  await assertModuleEnabled("HOME");
  const existing = requireLive(await findMaintenanceRecord(id, options), "Maintenance record");
  await findLiveProperty(existing.propertyId, "Maintenance record");
  await updateUnlessStale(options.baseUpdatedAt, (guard) =>
    prisma.homeItem.updateMany({ where: { id, ...guard }, data: patch }),
  );
  revalidatePath(`/home/${existing.propertyId}`);
  return findMaintenanceRecord(id);
}

export async function deleteMaintenanceRecordCommand(id: string, scope: PropertyScope = {}) {
  await assertModuleEnabled("HOME");
  const existing = await findMaintenanceRecord(id, scope);
  await prisma.homeItem.update({ where: { id }, data: { deletedAt: new Date() } });
  revalidatePath(`/home/${existing.propertyId}`);
  revalidatePath("/settings/trash");
}

export async function restoreMaintenanceRecordCommand(id: string) {
  await assertModuleEnabled("HOME");
  const existing = await findMaintenanceRecord(id);
  assertParentRestored(
    await prisma.property.findUnique({ where: { id: existing.propertyId }, select: { deletedAt: true } }),
    "Property",
  );
  await prisma.homeItem.update({ where: { id }, data: { deletedAt: null } });
  revalidatePath(`/home/${existing.propertyId}`);
  revalidatePath("/settings/trash");
}

export async function permanentlyDeleteMaintenanceRecordCommand(id: string) {
  await assertModuleEnabled("HOME");
  const { propertyId } = await purgeMaintenanceRecord(id);
  revalidatePath(`/home/${propertyId}`);
  revalidatePath("/settings/trash");
}

// See purgeProperty: for Trash retention only.
export async function purgeMaintenanceRecord(id: string) {
  const existing = await findMaintenanceRecord(id);
  // Cascades to the record's Document rows; then the files go.
  await prisma.homeItem.delete({ where: { id } });
  await removeOwnerDocumentFiles("HOME_ITEM", id);
  return { propertyId: existing.propertyId };
}

// ── Tenancy (RentalAgreement) ───────────────────────────────────────────────

// Why a Contract can't be linked to a Tenancy. Its own error, not a
// RecordNotFoundError, so a caller can tell "that Contract" apart from
// "this Tenancy" not being found.
export type TenancyContractProblem = "not-found" | "wrong-category" | "already-linked";

function tenancyContractMessage(problem: TenancyContractProblem) {
  switch (problem) {
    case "not-found":
      return "Contract not found.";
    case "wrong-category":
      return "Only Rental-category contracts can be linked.";
    case "already-linked":
      return "That contract is already linked to another tenancy.";
  }
}

export class TenancyContractLinkError extends Error {
  constructor(public readonly problem: TenancyContractProblem) {
    super(tenancyContractMessage(problem));
    this.name = "TenancyContractLinkError";
  }
}

// RentalAgreement.contractId is unique, so a link racing another to the
// same Contract fails its write with P2002 instead of the check before it.
function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

function revalidateRental(propertyId: string) {
  revalidatePath(`/home/${propertyId}`);
  revalidatePath(`/home/${propertyId}/rental`);
}

async function findTenancy(id: string, scope: PropertyScope = {}) {
  const agreement = await prisma.rentalAgreement.findUnique({ where: { id } });
  if (!agreement || !inScope(agreement, scope)) throw new RecordNotFoundError("Tenancy");
  return agreement;
}

// Adding a Tenancy also turns rental tracking on for its Property.
export async function createTenancyCommand(propertyId: string, input: RentalAgreementInput, actorId: string) {
  await assertModuleEnabled("HOME");
  await findLiveProperty(propertyId);
  const [agreement] = await prisma.$transaction([
    prisma.rentalAgreement.create({ data: { ...input, propertyId } }),
    prisma.property.update({ where: { id: propertyId }, data: { isRented: true, updatedById: actorId } }),
  ]);
  revalidateRental(propertyId);
  return agreement;
}

// Partial patch, as for updatePropertyCommand. No stale-edit check: the
// table has no updatedAt to compare against.
export async function updateTenancyCommand(
  id: string,
  patch: ClearablePatch<RentalAgreementInput>,
  scope: PropertyScope = {},
) {
  await assertModuleEnabled("HOME");
  const existing = await findTenancy(id, scope);
  await findLiveProperty(existing.propertyId, "Tenancy");
  const agreement = await prisma.rentalAgreement.update({ where: { id }, data: patch });
  revalidateRental(existing.propertyId);
  return agreement;
}

// Links the Tenancy to a Rental-category Contract, or unlinks it (null). A
// Contract in Trash counts as not found, and one already linked to another
// Tenancy is refused: a Contract links to one Tenancy at most.
export async function linkTenancyContractCommand(
  id: string,
  contractId: string | null,
  scope: PropertyScope = {},
) {
  await assertModuleEnabled("HOME");
  const existing = await findTenancy(id, scope);
  await findLiveProperty(existing.propertyId, "Tenancy");
  if (contractId !== null) {
    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      select: { category: true, deletedAt: true },
    });
    if (!contract || contract.deletedAt) throw new TenancyContractLinkError("not-found");
    if (contract.category !== "RENTAL") throw new TenancyContractLinkError("wrong-category");
    const other = await prisma.rentalAgreement.findFirst({
      where: { contractId, id: { not: id } },
      select: { id: true },
    });
    if (other) throw new TenancyContractLinkError("already-linked");
  }
  try {
    await prisma.rentalAgreement.update({ where: { id }, data: { contractId } });
  } catch (error) {
    if (isUniqueViolation(error)) throw new TenancyContractLinkError("already-linked");
    throw error;
  }
  revalidatePath(`/home/${existing.propertyId}/rental`);
  revalidatePath("/contracts");
  if (existing.contractId) revalidatePath(`/contracts/${existing.contractId}`);
  if (contractId) revalidatePath(`/contracts/${contractId}`);
}

// A Tenancy has no Trash: this deletes it for good, with its sent-Reminder
// log (#388). A linked Contract is left alone (the link is on the Tenancy's
// side).
export async function permanentlyDeleteTenancyCommand(id: string, scope: PropertyScope = {}) {
  await assertModuleEnabled("HOME");
  const existing = await findTenancy(id, scope);
  await prisma.rentalAgreement.delete({ where: { id } });
  await clearNotificationLogs("TENANCY", id);
  revalidateRental(existing.propertyId);
  if (existing.contractId) revalidatePath(`/contracts/${existing.contractId}`);
}

// ── Rental statement ────────────────────────────────────────────────────────

async function findRentalStatement(id: string, scope: PropertyScope = {}) {
  const statement = await prisma.rentalStatement.findUnique({ where: { id } });
  if (!statement || !inScope(statement, scope)) throw new RecordNotFoundError("Rental statement");
  return statement;
}

export async function createRentalStatementCommand(propertyId: string, input: RentalStatementInput) {
  await assertModuleEnabled("HOME");
  await findLiveProperty(propertyId);
  const statement = await prisma.rentalStatement.create({ data: { ...input, propertyId } });
  revalidatePath(`/home/${propertyId}/rental`);
  return statement;
}

// Partial patch, as for updatePropertyCommand.
export async function updateRentalStatementCommand(
  id: string,
  patch: ClearablePatch<RentalStatementInput>,
  options: UpdateOptions & PropertyScope = {},
) {
  await assertModuleEnabled("HOME");
  const existing = await findRentalStatement(id, options);
  await findLiveProperty(existing.propertyId, "Rental statement");
  await updateUnlessStale(options.baseUpdatedAt, (guard) =>
    prisma.rentalStatement.updateMany({ where: { id, ...guard }, data: patch }),
  );
  revalidatePath(`/home/${existing.propertyId}/rental`);
  return findRentalStatement(id);
}

// A Rental statement has no Trash: this deletes it and its files for good.
export async function permanentlyDeleteRentalStatementCommand(id: string, scope: PropertyScope = {}) {
  await assertModuleEnabled("HOME");
  const existing = await findRentalStatement(id, scope);
  // Cascades to the statement's Document rows; then the files go.
  await prisma.rentalStatement.delete({ where: { id } });
  await removeOwnerDocumentFiles("RENTAL_STATEMENT", id);
  revalidatePath(`/home/${existing.propertyId}/rental`);
}

// ── Property valuation ──────────────────────────────────────────────────────
// Create and delete only: a valuation is never edited, a new one is added.
// Valuations feed net worth, so /wealth is revalidated too.

export async function createPropertyValuationCommand(propertyId: string, input: PropertyValuationInput) {
  await assertModuleEnabled("HOME");
  await findLiveProperty(propertyId);
  const valuation = await prisma.propertyValuation.create({ data: { ...input, propertyId } });
  revalidatePath(`/home/${propertyId}`);
  revalidatePath("/wealth");
  return valuation;
}

export async function deletePropertyValuationCommand(id: string, scope: PropertyScope = {}) {
  await assertModuleEnabled("HOME");
  const valuation = await prisma.propertyValuation.findUnique({ where: { id } });
  if (!valuation || !inScope(valuation, scope)) throw new RecordNotFoundError("Valuation");
  await prisma.propertyValuation.delete({ where: { id } });
  revalidatePath(`/home/${valuation.propertyId}`);
  revalidatePath("/wealth");
}
