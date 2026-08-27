import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { deleteContractDir } from "@/lib/storage";
import { clearNotificationLogs } from "@/lib/notifications/logs";
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

export async function updateContractCommand(id: string, input: ContractInput, actorId: string) {
  const existing = await prisma.contract.findUnique({ where: { id } });
  if (!existing) throw new Error("Contract not found");
  const endDateChanged = existing.endDate?.getTime() !== input.endDate?.getTime();
  await prisma.$transaction([
    prisma.contract.update({ where: { id }, data: { ...input, updatedById: actorId } }),
    ...(endDateChanged ? [prisma.notificationLog.deleteMany({ where: { ownerType: "CONTRACT", ownerId: id } })] : []),
  ]);
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
  const existing = await prisma.contract.findUnique({ where: { id } });
  if (!existing) throw new Error("Contract not found");
  await prisma.contract.delete({ where: { id } });
  // NotificationLog is no longer FK-linked to Contract (it's polymorphic
  // across contract/product/vehicle owners, see #201), so this cleanup is
  // no longer an automatic cascade — has to happen explicitly.
  await clearNotificationLogs("CONTRACT", id);
  await deleteContractDir(id);
  revalidatePath("/settings/trash");
}
