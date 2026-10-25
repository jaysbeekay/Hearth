import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { removeOwnerDocumentFiles } from "@/lib/commands/documents";
import { clearNotificationLogs } from "@/lib/notifications/logs";
import { updateUnlessStale, RecordNotFoundError, type UpdateOptions } from "@/lib/commands/shared";
import type { ClearablePatch } from "@/lib/validation/fullFormUpdate";
import type { ContractInput } from "@/lib/validation/contract";
import type { Prisma } from "@/generated/prisma/client";

// Record commands for Contracts (ADR 0003). Every write to `contract` goes
// through here: server actions (the edit form, Cancel / Reactivate, Confirm
// details, the Assistant), extraction review, the offline sync handler,
// import and Trash retention. Callers own sign-in, role checks and Zod
// parsing; these own the write, file cleanup and revalidation.
//
// A Contract in Trash is read-only until it's restored: an update, a status
// change or a Confirm details on one is refused as not found, as its page
// already 404s. Delete, restore and permanent delete still work on it.

/** Extraction bookkeeping a create or update can set alongside the input. */
export interface ContractExtractionFields {
  extractionPending?: boolean;
  extractionConfirmedAt?: Date | null;
}

export type ContractPatch = ClearablePatch<ContractInput> & ContractExtractionFields;

/** The fields a field-level extraction review can correct (#331). */
export type ContractReviewCorrections = ClearablePatch<
  Pick<ContractInput, "title" | "provider" | "cost" | "startDate" | "endDate">
>;

type ContractClient = Pick<Prisma.TransactionClient, "contract">;

async function findContract(id: string, client: ContractClient = prisma) {
  const contract = await client.contract.findUnique({ where: { id } });
  if (!contract) throw new RecordNotFoundError("Contract");
  return contract;
}

// For writes to a Contract: one in Trash counts as not found.
async function findLiveContract(id: string, client: ContractClient = prisma) {
  const contract = await findContract(id, client);
  if (contract.deletedAt) throw new RecordNotFoundError("Contract");
  return contract;
}

function revalidateContract(id: string) {
  revalidatePath("/contracts");
  revalidatePath(`/contracts/${id}`);
  revalidatePath("/dashboard");
}

// The one write behind every update: refuses a missing or trashed Contract
// and a stale edit, then runs `alsoInTransaction` (extraction review's
// bookkeeping) in the same transaction, so both land or neither does.
async function writeContract(
  id: string,
  patch: ContractPatch,
  actorId: string,
  options: UpdateOptions,
  alsoInTransaction?: (tx: Prisma.TransactionClient) => Promise<unknown>,
) {
  await prisma.$transaction(async (tx) => {
    await findLiveContract(id, tx);
    // A date change needs no Reminder-log reset: the log is keyed by date (ADR 0003).
    await updateUnlessStale(options.baseUpdatedAt, (guard) =>
      tx.contract.updateMany({ where: { id, ...guard }, data: { ...patch, updatedById: actorId } }),
    );
    if (alsoInTransaction) await alsoInTransaction(tx);
  });
  revalidateContract(id);
}

export async function createContractCommand(
  input: ContractInput,
  actorId: string,
  extra?: ContractExtractionFields,
) {
  const contract = await prisma.contract.create({
    data: { ...input, ...extra, createdById: actorId },
  });
  revalidatePath("/contracts");
  revalidatePath("/dashboard");
  return contract;
}

// Partial patch: keys left out (or undefined) are not written, and a `null`
// clears the field. A full edit form sends fullFormUpdate()'s patch, where
// every field it submitted blank is `null` (#413); Cancel / Reactivate sends
// just `{ status }`.
export async function updateContractCommand(
  id: string,
  patch: ContractPatch,
  actorId: string,
  options: UpdateOptions = {},
) {
  await writeContract(id, patch, actorId, options);
  return { id };
}

// Confirm details (#200) and field-level extraction review (#331): applies
// the reviewer's corrections (none for a plain confirm), clears Needs review
// and marks every pending extraction review field reviewed, atomically.
export async function confirmContractExtractionCommand(
  id: string,
  corrections: ContractReviewCorrections,
  actorId: string,
) {
  const reviewedAt = new Date();
  await writeContract(
    id,
    { ...corrections, extractionPending: false, extractionConfirmedAt: reviewedAt },
    actorId,
    {},
    (tx) =>
      tx.extractionReviewField.updateMany({
        where: { ownerType: "CONTRACT", ownerId: id, reviewedAt: null },
        data: { reviewedAt, reviewedById: actorId },
      }),
  );
  return { id };
}

// #287 — soft-delete: moves the contract to Trash instead of removing it.
// Files and the DB row stay intact so restoreContractCommand can bring it
// back exactly as it was; permanentlyDeleteContractCommand (reachable only
// from Trash) does the actual cleanup this used to do unconditionally.
export async function deleteContractCommand(id: string) {
  await findContract(id);
  await prisma.contract.update({ where: { id }, data: { deletedAt: new Date() } });
  revalidatePath("/contracts");
  revalidatePath("/dashboard");
  revalidatePath("/settings/trash");
}

export async function restoreContractCommand(id: string) {
  await findContract(id);
  await prisma.contract.update({ where: { id }, data: { deletedAt: null } });
  revalidateContract(id);
  revalidatePath("/settings/trash");
}

export async function permanentlyDeleteContractCommand(id: string) {
  await purgeContract(id);
  revalidatePath("/settings/trash");
}

// The row-and-files part of a permanent delete, with no revalidation, so
// Trash retention (src/lib/trash.ts) can call it from a page render.
export async function purgeContract(id: string) {
  await findContract(id);
  await prisma.contract.delete({ where: { id } });
  // Files first, straight after the row: if clearing the log below throws,
  // the files mustn't be left orphaned with no row pointing at them (#413).
  await removeOwnerDocumentFiles("CONTRACT", id);
  // NotificationLog is polymorphic across owners (#201), so it doesn't
  // cascade with the row; clear it explicitly.
  await clearNotificationLogs("CONTRACT", id);
}
