import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { removeOwnerDocumentFiles } from "@/lib/commands/documents";
import { clearNotificationLogs } from "@/lib/notifications/logs";
import { updateUnlessStale, RecordNotFoundError, type UpdateOptions } from "@/lib/commands/shared";
import type { ClearablePatch } from "@/lib/validation/fullFormUpdate";
import type { ProductInput } from "@/lib/validation/product";
import type { Prisma } from "@/generated/prisma/client";

// Record commands for Products (Items), as for Contracts in
// commands/contracts.ts (ADR 0003): every write to `product` goes through
// here, and a Product in Trash is read-only until it's restored.

/** Extraction bookkeeping a create or update can set alongside the input. */
export interface ProductExtractionFields {
  extractionPending?: boolean;
  extractionConfirmedAt?: Date | null;
}

export type ProductPatch = ClearablePatch<ProductInput> & ProductExtractionFields;

/** The fields a field-level extraction review can correct (#331). */
export type ProductReviewCorrections = ClearablePatch<
  Pick<ProductInput, "description" | "manufacturer" | "price" | "purchaseDate" | "warrantyEndDate">
>;

type ProductClient = Pick<Prisma.TransactionClient, "product">;

async function findProduct(id: string, client: ProductClient = prisma) {
  const product = await client.product.findUnique({ where: { id } });
  if (!product) throw new RecordNotFoundError("Product");
  return product;
}

// For writes to a Product: one in Trash counts as not found.
async function findLiveProduct(id: string, client: ProductClient = prisma) {
  const product = await findProduct(id, client);
  if (product.deletedAt) throw new RecordNotFoundError("Product");
  return product;
}

function revalidateProduct(id: string) {
  revalidatePath("/products");
  revalidatePath(`/products/${id}`);
  revalidatePath("/dashboard");
}

// The one write behind every update, as writeContract.
async function writeProduct(
  id: string,
  patch: ProductPatch,
  actorId: string,
  options: UpdateOptions,
  alsoInTransaction?: (tx: Prisma.TransactionClient) => Promise<unknown>,
) {
  await prisma.$transaction(async (tx) => {
    await findLiveProduct(id, tx);
    // A date change needs no Reminder-log reset: the log is keyed by date (ADR 0003).
    await updateUnlessStale(options.baseUpdatedAt, (guard) =>
      tx.product.updateMany({ where: { id, ...guard }, data: { ...patch, updatedById: actorId } }),
    );
    if (alsoInTransaction) await alsoInTransaction(tx);
  });
  revalidateProduct(id);
}

export async function createProductCommand(
  input: ProductInput,
  actorId: string,
  extra?: ProductExtractionFields,
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
  patch: ProductPatch,
  actorId: string,
  options: UpdateOptions = {},
) {
  await writeProduct(id, patch, actorId, options);
  return { id };
}

// Confirm details and field-level extraction review, as
// confirmContractExtractionCommand.
export async function confirmProductExtractionCommand(
  id: string,
  corrections: ProductReviewCorrections,
  actorId: string,
) {
  const reviewedAt = new Date();
  await writeProduct(
    id,
    { ...corrections, extractionPending: false, extractionConfirmedAt: reviewedAt },
    actorId,
    {},
    (tx) =>
      tx.extractionReviewField.updateMany({
        where: { ownerType: "PRODUCT", ownerId: id, reviewedAt: null },
        data: { reviewedAt, reviewedById: actorId },
      }),
  );
  return { id };
}

// #287 — soft-delete: see the equivalent comment on deleteContractCommand.
export async function deleteProductCommand(id: string) {
  await findProduct(id);
  await prisma.product.update({ where: { id }, data: { deletedAt: new Date() } });
  revalidatePath("/products");
  revalidatePath("/dashboard");
  revalidatePath("/settings/trash");
}

export async function restoreProductCommand(id: string) {
  await findProduct(id);
  await prisma.product.update({ where: { id }, data: { deletedAt: null } });
  revalidateProduct(id);
  revalidatePath("/settings/trash");
}

export async function permanentlyDeleteProductCommand(id: string) {
  await purgeProduct(id);
  revalidatePath("/settings/trash");
}

// The row-and-files part of a permanent delete, with no revalidation, so
// Trash retention (src/lib/trash.ts) can call it from a page render.
export async function purgeProduct(id: string) {
  await findProduct(id);
  await prisma.product.delete({ where: { id } });
  // Files first, straight after the row: if clearing the log below throws,
  // the files mustn't be left orphaned with no row pointing at them (#413).
  await removeOwnerDocumentFiles("PRODUCT", id);
  // NotificationLog is polymorphic across owners (#201), so it doesn't
  // cascade with the row; clear it explicitly.
  await clearNotificationLogs("PRODUCT", id);
}
