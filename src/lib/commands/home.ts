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
import type {
  PropertyInput,
  HomeItemInput,
  RentalAgreementInput,
  RentalStatementInput,
} from "@/lib/validation/home";
import type { PropertyValuationInput } from "@/lib/validation/wealth";
import type { Prisma } from "@/generated/prisma/client";

// Record commands for the Property module (#390, ADR 0003): Properties,
// Maintenance records (`homeItem`), Tenancies (`rentalAgreement`), Rental
// statements and Property valuations. Every write to those tables goes
// through here: server actions, the offline sync handler and Trash
// retention. Callers own sign-in, role checks and Zod parsing; these own
// the HOME module gate, the write, file cleanup and revalidation.
//
// Every one of them has a Trash (a `deletedAt` column): Properties and
// Maintenance records since #287, Tenancies, Rental statements and Property
// valuations since #427. Deleting moves the record to Trash; permanent
// delete (from Trash, or the 30-day purge) removes the row and its files.
//
// A record in Trash is read-only until it's restored: a create or update
// under a Property in Trash, or to a record that's itself in Trash, is
// refused as not found, as the pages already 404 them. Delete, restore and
// permanent delete still work on it, but a record under a Property can't
// be restored while its Property is still in Trash (#428, the rules in
// shared.ts). Updates carry that rule in their guarded write; creates and
// restores check and write in one transaction, so a move to Trash can't
// land in between.
//
// No Property-module record has Reminders yet, so nothing here touches the
// sent-Reminder log (Tenancy Reminders are #388).

// ── Property ────────────────────────────────────────────────────────────────

function revalidatePropertyLists() {
  revalidatePath("/home");
}

// The global client, or a transaction's `tx` (which must then be used for
// every query inside it).
type Db = Prisma.TransactionClient;

function loadProperty(id: string, db: Db = prisma) {
  return db.property.findUnique({ where: { id } });
}

// For delete, restore and the row an update returns: Trash or not.
async function findProperty(id: string) {
  const property = await loadProperty(id);
  if (!property) throw new RecordNotFoundError("Property");
  return property;
}

// For writes to a Property or under it, as `what`: one in Trash counts as
// not found.
function findLiveProperty(id: string, what = "Property", db: Db = prisma) {
  return findLiveParent(loadProperty(id, db), what);
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
  await updateLiveUnlessStale(
    options.baseUpdatedAt,
    (guard) =>
      prisma.property.updateMany({
        where: { id, deletedAt: null, ...guard },
        data: { ...patch, updatedById: actorId },
      }),
    () => findLiveProperty(id),
  );
  revalidatePropertyLists();
  revalidatePath(`/home/${id}`);
  return findProperty(id);
}

// Turns rental tracking (the Rental tab) on or off for a Property.
export async function setPropertyRentedCommand(id: string, isRented: boolean, actorId: string) {
  await assertModuleEnabled("HOME");
  await updateLiveUnlessStale(
    undefined,
    () => prisma.property.updateMany({ where: { id, deletedAt: null }, data: { isRented, updatedById: actorId } }),
    () => findLiveProperty(id),
  );
  revalidatePath(`/home/${id}`);
  revalidatePath(`/home/${id}/rental`);
}

// #355 — Archive: the household no longer has the Property (sold, or its
// lease ended). Not Trash: it stays where it is, viewable, with its
// Maintenance records, Tenancies and Documents, but its Tenancy's lease end
// stops being Due and stops getting Reminders (src/lib/tenancies.ts).
// Archiving an already Archived one keeps its original date. A Property in
// Trash is read-only, so it can't be archived or unarchived until restored.
// Contracts linked to it are untouched: a Contract is its own Due source.
export async function archivePropertyCommand(id: string, actorId: string, options: UpdateOptions = {}) {
  await assertModuleEnabled("HOME");
  await updateLiveUnlessStale(
    options.baseUpdatedAt,
    (guard) =>
      prisma.property.updateMany({
        where: { id, deletedAt: null, archivedAt: null, ...guard },
        data: { archivedAt: new Date(), updatedById: actorId },
      }),
    () => findLiveProperty(id),
  );
  revalidatePropertyLists();
  revalidatePath(`/home/${id}`);
  return findProperty(id);
}

export async function unarchivePropertyCommand(id: string, actorId: string, options: UpdateOptions = {}) {
  await assertModuleEnabled("HOME");
  await updateLiveUnlessStale(
    options.baseUpdatedAt,
    (guard) =>
      prisma.property.updateMany({
        where: { id, deletedAt: null, archivedAt: { not: null }, ...guard },
        data: { archivedAt: null, updatedById: actorId },
      }),
    () => findLiveProperty(id),
  );
  revalidatePropertyLists();
  revalidatePath(`/home/${id}`);
  return findProperty(id);
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
  const tenancyIds = existing.rentalAgreements.map((agreement) => agreement.id);
  if (tenancyIds.length > 0) {
    await prisma.notificationLog.deleteMany({ where: { ownerType: "TENANCY", ownerId: { in: tenancyIds } } });
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

// Restoring a record under a Property: refused while the Property is still
// in Trash. Runs inside the restore's transaction.
async function assertPropertyRestored(propertyId: string, db: Db) {
  assertParentRestored(
    await db.property.findUnique({ where: { id: propertyId }, select: { deletedAt: true } }),
    "Property",
  );
}

// ── Maintenance record (HomeItem) ───────────────────────────────────────────

async function findMaintenanceRecord(id: string, scope: PropertyScope = {}, db: Db = prisma) {
  const item = await db.homeItem.findUnique({ where: { id } });
  if (!item || !inScope(item, scope)) throw new RecordNotFoundError("Maintenance record");
  return item;
}

export async function createMaintenanceRecordCommand(propertyId: string, input: HomeItemInput) {
  await assertModuleEnabled("HOME");
  const item = await prisma.$transaction(async (tx) => {
    await findLiveProperty(propertyId, "Property", tx);
    return tx.homeItem.create({ data: { ...input, propertyId } });
  });
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
  await updateLiveUnlessStale(
    options.baseUpdatedAt,
    (guard) =>
      prisma.homeItem.updateMany({
        where: { id, propertyId: options.propertyId, deletedAt: null, property: { deletedAt: null }, ...guard },
        data: patch,
      }),
    async () => {
      const existing = requireLive(await findMaintenanceRecord(id, options), "Maintenance record");
      await findLiveProperty(existing.propertyId, "Maintenance record");
    },
  );
  const item = await findMaintenanceRecord(id);
  revalidatePath(`/home/${item.propertyId}`);
  return item;
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
  const existing = await prisma.$transaction(async (tx) => {
    const item = await findMaintenanceRecord(id, {}, tx);
    await assertPropertyRestored(item.propertyId, tx);
    await tx.homeItem.update({ where: { id }, data: { deletedAt: null } });
    return item;
  });
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
export type TenancyContractProblem = "not-found" | "wrong-category" | "already-linked" | "linked-in-trash";

function tenancyContractMessage(problem: TenancyContractProblem) {
  switch (problem) {
    case "not-found":
      return "Contract not found.";
    case "wrong-category":
      return "Only Rental-category contracts can be linked.";
    case "already-linked":
      return "That contract is already linked to another tenancy.";
    case "linked-in-trash":
      return "That contract is linked to a deleted tenancy. Restore the tenancy from Recently deleted, or delete it permanently.";
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

// For delete, restore and the row an update returns: Trash or not.
async function findTenancy(id: string, scope: PropertyScope = {}, db: Db = prisma) {
  const agreement = await db.rentalAgreement.findUnique({ where: { id } });
  if (!agreement || !inScope(agreement, scope)) throw new RecordNotFoundError("Tenancy");
  return agreement;
}

// Adding a Tenancy also turns rental tracking on for its Property.
//
// A new Tenancy usually replaces the current one (currentTenancy in
// dueRecords.ts). The old one's sent-Reminder rows (ownerType TENANCY, its
// id) stay until it's permanently deleted. That's harmless: only the
// current Tenancy gets Reminders, the rows are keyed by the old Tenancy's id
// so they never count for the new one, and should the old one become
// current again its rows only match a lease end they were really sent for
// (ADR 0003).
export async function createTenancyCommand(propertyId: string, input: RentalAgreementInput, actorId: string) {
  await assertModuleEnabled("HOME");
  const agreement = await prisma.$transaction(async (tx) => {
    await findLiveProperty(propertyId, "Property", tx);
    const created = await tx.rentalAgreement.create({ data: { ...input, propertyId } });
    await tx.property.update({ where: { id: propertyId }, data: { isRented: true, updatedById: actorId } });
    return created;
  });
  revalidateRental(propertyId);
  return agreement;
}

// The Tenancy if it and its Property are live; otherwise "Tenancy" not found.
async function findLiveTenancy(id: string, scope: PropertyScope = {}) {
  const existing = requireLive(await findTenancy(id, scope), "Tenancy");
  await findLiveProperty(existing.propertyId, "Tenancy");
  return existing;
}

// Partial patch, as for updatePropertyCommand. With a baseUpdatedAt (an
// offline edit), an edit that landed since is refused as stale (#427 gave
// the table its updatedAt).
export async function updateTenancyCommand(
  id: string,
  patch: ClearablePatch<RentalAgreementInput>,
  options: UpdateOptions & PropertyScope = {},
) {
  await assertModuleEnabled("HOME");
  await updateLiveUnlessStale(
    options.baseUpdatedAt,
    (guard) =>
      prisma.rentalAgreement.updateMany({
        where: { id, propertyId: options.propertyId, deletedAt: null, property: { deletedAt: null }, ...guard },
        data: patch,
      }),
    () => findLiveTenancy(id, options),
  );
  const agreement = await findTenancy(id);
  revalidateRental(agreement.propertyId);
  return agreement;
}

// Links the Tenancy to a Rental-category Contract, or unlinks it (null). A
// Contract in Trash counts as not found, and one already linked to another
// Tenancy is refused: a Contract links to one Tenancy at most. A Tenancy in
// Trash keeps its link (so restoring it brings the link back), so its
// Contract still counts as linked until the Tenancy is deleted for good.
export async function linkTenancyContractCommand(
  id: string,
  contractId: string | null,
  scope: PropertyScope = {},
) {
  await assertModuleEnabled("HOME");
  const existing = await findLiveTenancy(id, scope);
  if (contractId !== null) {
    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      select: { category: true, deletedAt: true },
    });
    if (!contract || contract.deletedAt) throw new TenancyContractLinkError("not-found");
    if (contract.category !== "RENTAL") throw new TenancyContractLinkError("wrong-category");
    const other = await prisma.rentalAgreement.findFirst({
      where: { contractId, id: { not: id } },
      select: { id: true, deletedAt: true },
    });
    if (other) throw new TenancyContractLinkError(other.deletedAt ? "linked-in-trash" : "already-linked");
  }
  try {
    await updateLiveUnlessStale(
      undefined,
      () =>
        prisma.rentalAgreement.updateMany({
          where: { id, deletedAt: null, property: { deletedAt: null } },
          data: { contractId },
        }),
      () => findLiveTenancy(id),
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw new TenancyContractLinkError("already-linked");
    throw error;
  }
  revalidatePath(`/home/${existing.propertyId}/rental`);
  revalidatePath("/contracts");
  if (existing.contractId) revalidatePath(`/contracts/${existing.contractId}`);
  if (contractId) revalidatePath(`/contracts/${contractId}`);
}

function revalidateTenancy(tenancy: { propertyId: string; contractId: string | null }) {
  revalidateRental(tenancy.propertyId);
  revalidatePath("/dashboard");
  // Upcoming shows the current Tenancy's lease end.
  revalidatePath("/calendar");
  if (tenancy.contractId) revalidatePath(`/contracts/${tenancy.contractId}`);
  revalidatePath("/settings/trash");
}

// #427 — soft delete: moves the Tenancy to Trash, keeping its Contract link
// so a restore brings it back as it was. Already in Trash is a no-op, so a
// replayed offline delete doesn't restart its 30 days.
export async function deleteTenancyCommand(id: string, scope: PropertyScope = {}) {
  await assertModuleEnabled("HOME");
  const existing = await findTenancy(id, scope);
  if (!existing.deletedAt) {
    await prisma.rentalAgreement.update({ where: { id }, data: { deletedAt: new Date() } });
  }
  revalidateTenancy(existing);
}

export async function restoreTenancyCommand(id: string) {
  await assertModuleEnabled("HOME");
  const existing = await prisma.$transaction(async (tx) => {
    const agreement = await findTenancy(id, {}, tx);
    await assertPropertyRestored(agreement.propertyId, tx);
    await tx.rentalAgreement.update({ where: { id }, data: { deletedAt: null } });
    return agreement;
  });
  revalidateTenancy(existing);
}

export async function permanentlyDeleteTenancyCommand(id: string) {
  await assertModuleEnabled("HOME");
  revalidateTenancy(await purgeTenancy(id));
}

// See purgeProperty: for Trash retention only. A Tenancy has no Documents,
// so there are no files to remove, but its sent-Reminder log goes with it
// (#388; NotificationLog is polymorphic, so no cascade). A linked Contract
// is left alone (the link is on the Tenancy's side).
export async function purgeTenancy(id: string) {
  const existing = await findTenancy(id);
  await prisma.rentalAgreement.delete({ where: { id } });
  await clearNotificationLogs("TENANCY", id);
  return existing;
}

// ── Rental statement ────────────────────────────────────────────────────────

// For delete, restore and the row an update returns: Trash or not.
async function findRentalStatement(id: string, scope: PropertyScope = {}, db: Db = prisma) {
  const statement = await db.rentalStatement.findUnique({ where: { id } });
  if (!statement || !inScope(statement, scope)) throw new RecordNotFoundError("Rental statement");
  return statement;
}

export async function createRentalStatementCommand(propertyId: string, input: RentalStatementInput) {
  await assertModuleEnabled("HOME");
  const statement = await prisma.$transaction(async (tx) => {
    await findLiveProperty(propertyId, "Property", tx);
    return tx.rentalStatement.create({ data: { ...input, propertyId } });
  });
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
  await updateLiveUnlessStale(
    options.baseUpdatedAt,
    (guard) =>
      prisma.rentalStatement.updateMany({
        where: { id, propertyId: options.propertyId, deletedAt: null, property: { deletedAt: null }, ...guard },
        data: patch,
      }),
    async () => {
      const existing = requireLive(await findRentalStatement(id, options), "Rental statement");
      await findLiveProperty(existing.propertyId, "Rental statement");
    },
  );
  const statement = await findRentalStatement(id);
  revalidatePath(`/home/${statement.propertyId}/rental`);
  return statement;
}

function revalidateStatement(propertyId: string) {
  revalidatePath(`/home/${propertyId}/rental`);
  revalidatePath("/settings/trash");
}

// #427 — soft delete: moves the statement to Trash. Its Documents and their
// files stay as they are (each keeps its own Trash state), so a restore
// brings it back as it was. Already in Trash is a no-op.
export async function deleteRentalStatementCommand(id: string, scope: PropertyScope = {}) {
  await assertModuleEnabled("HOME");
  const existing = await findRentalStatement(id, scope);
  if (!existing.deletedAt) {
    await prisma.rentalStatement.update({ where: { id }, data: { deletedAt: new Date() } });
  }
  revalidateStatement(existing.propertyId);
}

export async function restoreRentalStatementCommand(id: string) {
  await assertModuleEnabled("HOME");
  const existing = await prisma.$transaction(async (tx) => {
    const statement = await findRentalStatement(id, {}, tx);
    await assertPropertyRestored(statement.propertyId, tx);
    await tx.rentalStatement.update({ where: { id }, data: { deletedAt: null } });
    return statement;
  });
  revalidateStatement(existing.propertyId);
}

export async function permanentlyDeleteRentalStatementCommand(id: string) {
  await assertModuleEnabled("HOME");
  const { propertyId } = await purgeRentalStatement(id);
  revalidateStatement(propertyId);
}

// See purgeProperty: for Trash retention only.
export async function purgeRentalStatement(id: string) {
  const existing = await findRentalStatement(id);
  // Cascades to the statement's Document rows (Trash ones included); then
  // the files go.
  await prisma.rentalStatement.delete({ where: { id } });
  await removeOwnerDocumentFiles("RENTAL_STATEMENT", id);
  return { propertyId: existing.propertyId };
}

// ── Property valuation ──────────────────────────────────────────────────────
// Never edited (a new one is added instead), but it goes to Trash like the
// rest (#427). Valuations feed net worth, so /wealth is revalidated too; one
// in Trash doesn't count towards it.

export async function createPropertyValuationCommand(propertyId: string, input: PropertyValuationInput) {
  await assertModuleEnabled("HOME");
  const valuation = await prisma.$transaction(async (tx) => {
    await findLiveProperty(propertyId, "Property", tx);
    return tx.propertyValuation.create({ data: { ...input, propertyId } });
  });
  revalidatePath(`/home/${propertyId}`);
  revalidatePath("/wealth");
  return valuation;
}

async function findPropertyValuation(id: string, scope: PropertyScope = {}, db: Db = prisma) {
  const valuation = await db.propertyValuation.findUnique({ where: { id } });
  if (!valuation || !inScope(valuation, scope)) throw new RecordNotFoundError("Valuation");
  return valuation;
}

function revalidateValuation(propertyId: string) {
  revalidatePath(`/home/${propertyId}`);
  revalidatePath("/home");
  revalidatePath("/wealth");
  revalidatePath("/settings/trash");
}

// #427 — soft delete: moves the valuation to Trash. Already in Trash is a
// no-op.
export async function deletePropertyValuationCommand(id: string, scope: PropertyScope = {}) {
  await assertModuleEnabled("HOME");
  const valuation = await findPropertyValuation(id, scope);
  if (!valuation.deletedAt) {
    await prisma.propertyValuation.update({ where: { id }, data: { deletedAt: new Date() } });
  }
  revalidateValuation(valuation.propertyId);
}

export async function restorePropertyValuationCommand(id: string) {
  await assertModuleEnabled("HOME");
  const existing = await prisma.$transaction(async (tx) => {
    const valuation = await findPropertyValuation(id, {}, tx);
    await assertPropertyRestored(valuation.propertyId, tx);
    await tx.propertyValuation.update({ where: { id }, data: { deletedAt: null } });
    return valuation;
  });
  revalidateValuation(existing.propertyId);
}

export async function permanentlyDeletePropertyValuationCommand(id: string) {
  await assertModuleEnabled("HOME");
  const { propertyId } = await purgePropertyValuation(id);
  revalidateValuation(propertyId);
}

// See purgeProperty: for Trash retention only. A valuation has no files.
export async function purgePropertyValuation(id: string) {
  const existing = await findPropertyValuation(id);
  await prisma.propertyValuation.delete({ where: { id } });
  return { propertyId: existing.propertyId };
}
