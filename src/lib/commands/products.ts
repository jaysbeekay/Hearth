import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { removeOwnerDocumentFiles } from "@/lib/commands/documents";
import { clearNotificationLogs } from "@/lib/notifications/logs";
import { updateUnlessStale, type UpdateOptions } from "@/lib/commands/shared";
import type { ClearablePatch } from "@/lib/validation/fullFormUpdate";
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

// Partial patch: keys left out (or undefined) are not written, and a `null`
// clears the field. A full edit form sends fullFormUpdate()'s patch, where
// every field it submitted blank is `null` (#413).
export async function updateProductCommand(
  id: string,
  patch: ClearablePatch<ProductInput> & { extractionPending?: boolean; extractionConfirmedAt?: Date | null },
  actorId: string,
  options: UpdateOptions = {},
) {
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) throw new Error("Product not found");
  // A date change needs no Reminder-log reset: the log is keyed by date (ADR 0003).
  await updateUnlessStale(options.baseUpdatedAt, (guard) =>
    prisma.product.updateMany({ where: { id, ...guard }, data: { ...patch, updatedById: actorId } }),
  );
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
  await purgeProduct(id);
  revalidatePath("/settings/trash");
}

// The row-and-files part of a permanent delete, with no revalidation, so
// Trash retention (src/lib/trash.ts) can call it from a page render.
export async function purgeProduct(id: string) {
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) throw new Error("Product not found");
  await prisma.product.delete({ where: { id } });
  // Files first, straight after the row: if clearing the log below throws,
  // the files mustn't be left orphaned with no row pointing at them (#413).
  await removeOwnerDocumentFiles("PRODUCT", id);
  // NotificationLog is polymorphic across owners (#201), so it doesn't
  // cascade with the row; clear it explicitly.
  await clearNotificationLogs("PRODUCT", id);
}
