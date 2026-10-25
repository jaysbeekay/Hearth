import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { removeOwnerDocumentFiles } from "@/lib/commands/documents";
import { clearNotificationLogs } from "@/lib/notifications/logs";
import { updateUnlessStale, type UpdateOptions } from "@/lib/commands/shared";
import type { ClearablePatch } from "@/lib/validation/fullFormUpdate";
import type { ContractInput } from "@/lib/validation/contract";

export async function createContractCommand(
  input: ContractInput,
  actorId: string,
  extra?: { extractionPending?: boolean; extractionConfirmedAt?: Date | null },
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
// every field it submitted blank is `null` (#413).
export async function updateContractCommand(
  id: string,
  patch: ClearablePatch<ContractInput> & { extractionPending?: boolean; extractionConfirmedAt?: Date | null },
  actorId: string,
  options: UpdateOptions = {},
) {
  const existing = await prisma.contract.findUnique({ where: { id } });
  if (!existing) throw new Error("Contract not found");
  // A date change needs no Reminder-log reset: the log is keyed by date (ADR 0003).
  await updateUnlessStale(options.baseUpdatedAt, (guard) =>
    prisma.contract.updateMany({ where: { id, ...guard }, data: { ...patch, updatedById: actorId } }),
  );
  revalidatePath("/contracts");
  revalidatePath(`/contracts/${id}`);
  revalidatePath("/dashboard");
  return { id };
}

// #287 — soft-delete: moves the contract to Trash instead of removing it.
// Files and the DB row stay intact so restoreContractCommand can bring it
// back exactly as it was; permanentlyDeleteContractCommand (reachable only
// from Trash) does the actual cleanup this used to do unconditionally.
export async function deleteContractCommand(id: string) {
  const existing = await prisma.contract.findUnique({ where: { id } });
  if (!existing) throw new Error("Contract not found");
  await prisma.contract.update({ where: { id }, data: { deletedAt: new Date() } });
  revalidatePath("/contracts");
  revalidatePath("/dashboard");
  revalidatePath("/settings/trash");
}

export async function restoreContractCommand(id: string) {
  const existing = await prisma.contract.findUnique({ where: { id } });
  if (!existing) throw new Error("Contract not found");
  await prisma.contract.update({ where: { id }, data: { deletedAt: null } });
  revalidatePath("/contracts");
  revalidatePath("/dashboard");
  revalidatePath("/settings/trash");
}

export async function permanentlyDeleteContractCommand(id: string) {
  await purgeContract(id);
  revalidatePath("/settings/trash");
}

// The row-and-files part of a permanent delete, with no revalidation, so
// Trash retention (src/lib/trash.ts) can call it from a page render.
export async function purgeContract(id: string) {
  const existing = await prisma.contract.findUnique({ where: { id } });
  if (!existing) throw new Error("Contract not found");
  await prisma.contract.delete({ where: { id } });
  // Files first, straight after the row: if clearing the log below throws,
  // the files mustn't be left orphaned with no row pointing at them (#413).
  await removeOwnerDocumentFiles("CONTRACT", id);
  // NotificationLog is polymorphic across owners (#201), so it doesn't
  // cascade with the row; clear it explicitly.
  await clearNotificationLogs("CONTRACT", id);
}
