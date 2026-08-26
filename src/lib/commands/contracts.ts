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

export async function updateContractCommand(id: string, input: ContractInput) {
  const existing = await prisma.contract.findUnique({ where: { id } });
  if (!existing) throw new Error("Contract not found");
  const endDateChanged = existing.endDate?.getTime() !== input.endDate?.getTime();
  await prisma.$transaction([
    prisma.contract.update({ where: { id }, data: input }),
    ...(endDateChanged ? [prisma.notificationLog.deleteMany({ where: { ownerType: "CONTRACT", ownerId: id } })] : []),
  ]);
  revalidatePath("/contracts");
  revalidatePath(`/contracts/${id}`);
  revalidatePath("/dashboard");
  return { id };
}

export async function deleteContractCommand(id: string) {
  const existing = await prisma.contract.findUnique({ where: { id } });
  if (!existing) throw new Error("Contract not found");
  await prisma.contract.delete({ where: { id } });
  await clearNotificationLogs("CONTRACT", id);
  await deleteContractDir(id);
  revalidatePath("/contracts");
  revalidatePath("/dashboard");
}
