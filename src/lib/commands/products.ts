import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { deleteProductDir } from "@/lib/storage";
import { clearNotificationLogs } from "@/lib/notifications/logs";
import type { ProductInput } from "@/lib/validation/product";

export async function createProductCommand(
  input: ProductInput,
  actorId: string,
  extra?: { extractionPending?: boolean; extractionConfirmedAt?: Date | null },
) {
  const product = await prisma.product.create({
    data: { ...input, ...extra, createdById: actorId },
  });
  revalidatePath("/products");
  revalidatePath("/dashboard");
  return product;
}

export async function updateProductCommand(id: string, input: ProductInput, actorId: string) {
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) throw new Error("Product not found");
  const warrantyEndDateChanged = existing.warrantyEndDate?.getTime() !== input.warrantyEndDate?.getTime();
  await prisma.$transaction([
    prisma.product.update({ where: { id }, data: { ...input, updatedById: actorId } }),
    ...(warrantyEndDateChanged ? [prisma.notificationLog.deleteMany({ where: { ownerType: "PRODUCT", ownerId: id } })] : []),
  ]);
  revalidatePath("/products");
  revalidatePath(`/products/${id}`);
  revalidatePath("/dashboard");
  return { id };
}

// #287 — soft-delete: see the equivalent comment on deleteContractCommand.
export async function deleteProductCommand(id: string) {
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) throw new Error("Product not found");
  await prisma.product.update({ where: { id }, data: { deletedAt: new Date() } });
  revalidatePath("/products");
  revalidatePath("/dashboard");
  revalidatePath("/settings/trash");
}

export async function restoreProductCommand(id: string) {
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) throw new Error("Product not found");
  await prisma.product.update({ where: { id }, data: { deletedAt: null } });
  revalidatePath("/products");
  revalidatePath("/dashboard");
  revalidatePath("/settings/trash");
}

export async function permanentlyDeleteProductCommand(id: string) {
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) throw new Error("Product not found");
  await prisma.product.delete({ where: { id } });
  await clearNotificationLogs("PRODUCT", id);
  await deleteProductDir(id);
  revalidatePath("/settings/trash");
}
