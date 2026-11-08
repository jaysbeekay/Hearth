import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { removeOwnerDocumentFiles } from "@/lib/commands/documents";
import { clearNotificationLogs } from "@/lib/notifications/logs";
import {
  updateUnlessStale,
  assertNotStale,
  RecordNotFoundError,
  RecordValidationError,
  deleteFromTrash,
  type PurgeOptions,
  type UpdateOptions,
} from "@/lib/commands/shared";
import { assertLinksLive, newLinks } from "@/lib/commands/links";
import type { ClearablePatch } from "@/lib/validation/fullFormUpdate";
import type { ProductInput } from "@/lib/validation/product";
import { logExtractionConfirmed } from "@/lib/documents/extractionAudit";
import type { Prisma, Product } from "@/generated/prisma/client";
import { retireStagedProduct, syncLegacyProduct } from "@/lib/items/syncLegacyItem";

// Record commands for Products (Items), as for Contracts in
// commands/contracts.ts (ADR 0003): every write to `product` goes through
// here, and a Product in Trash is read-only until it's restored. Its
// Property link is checked as a Contract's is (links.ts).

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
  if (!product) throw new RecordNotFoundError("Warranty");
  return product;
}

// For writes to a Product: one in Trash counts as not found.
async function findLiveProduct(id: string, client: ProductClient = prisma) {
  const product = await findProduct(id, client);
  if (product.deletedAt) throw new RecordNotFoundError("Warranty");
  return product;
}

function revalidateProduct(id: string) {
  revalidatePath("/products");
  revalidatePath(`/products/${id}`);
  revalidatePath("/dashboard");
}

// As the Contract check: a patch that moves either date mustn't leave the
// warranty ending before the purchase.
function assertDateOrder(
  existing: { purchaseDate: Date | null; warrantyEndDate: Date | null },
  patch: ProductPatch,
) {
  if (patch.purchaseDate === undefined && patch.warrantyEndDate === undefined) return;
  const purchaseDate = patch.purchaseDate === undefined ? existing.purchaseDate : patch.purchaseDate;
  const warrantyEndDate = patch.warrantyEndDate === undefined ? existing.warrantyEndDate : patch.warrantyEndDate;
  if (purchaseDate && warrantyEndDate && warrantyEndDate < purchaseDate) {
    throw new RecordValidationError("Warranty end date can't be before the purchase date.");
  }
}

interface ProductWrite {
  // The patch, or a function that works it out inside the transaction.
  // It's given the Product as this transaction read it.
  patch: ProductPatch | ((tx: Prisma.TransactionClient, existing: Product) => Promise<ProductPatch>);
  // More writes that must land with the patch or not at all.
  alsoInTransaction?: (tx: Prisma.TransactionClient) => Promise<unknown>;
}

// The one write behind every update, as writeContract. Everything in here
// must use `tx`, never the global `prisma` (see writeContract: a query on
// `prisma` deadlocks against the open transaction).
async function writeProduct(id: string, actorId: string, options: UpdateOptions, write: ProductWrite) {
  await prisma.$transaction(async (tx) => {
    const existing = await findLiveProduct(id, tx);
    const patch = typeof write.patch === "function" ? await write.patch(tx, existing) : write.patch;
    // Stale first, so a stale offline replay is reported as stale rather
    // than as a link it no longer means to set.
    assertNotStale(existing, options.baseUpdatedAt);
    assertDateOrder(existing, patch);
    // In the transaction, so a move to Trash can't land between check and write (#447).
    await assertLinksLive(newLinks(patch, existing), tx);
    // A date change needs no Reminder-log reset: the log is keyed by date (ADR 0003).
    await updateUnlessStale(options.baseUpdatedAt, (guard) =>
      tx.product.updateMany({ where: { id, ...guard }, data: { ...patch, updatedById: actorId } }),
    );
    if (write.alsoInTransaction) await write.alsoInTransaction(tx);
    await syncLegacyProduct(tx, id);
  });
  revalidateProduct(id);
}

export async function createProductCommand(
  input: ProductInput,
  actorId: string,
  extra?: ProductExtractionFields,
  // Runs in the create's transaction (the MCP import approval links its
  // proposal here, #529); throwing rolls the new record back.
  alsoInTransaction?: (tx: Prisma.TransactionClient, created: { id: string }) => Promise<unknown>,
) {
  const product = await prisma.$transaction(async (tx) => {
    await assertLinksLive(input, tx);
    const created = await tx.product.create({ data: { ...input, ...extra, createdById: actorId } });
    if (alsoInTransaction) await alsoInTransaction(tx, created);
    await syncLegacyProduct(tx, created.id);
    return created;
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
  await writeProduct(id, actorId, options, { patch });
  return { id };
}

// Confirm details and field-level extraction review, as
// confirmContractExtractionCommand.
export async function confirmProductExtractionCommand(
  id: string,
  corrections: ProductReviewCorrections | ((pendingFieldNames: ReadonlySet<string>) => ProductReviewCorrections),
  actorId: string,
  // The record's updatedAt when the reviewer loaded it: refused if it has
  // changed since, so a review can't overwrite someone else's newer edit.
  options: UpdateOptions = {},
) {
  const reviewedAt = new Date();
  const pendingWhere = { ownerType: "PRODUCT" as const, ownerId: id, reviewedAt: null };
  let reviewedFieldNames: string[] = [];
  let wasAwaitingReview = false;
  await writeProduct(id, actorId, options, {
    patch: async (tx, existing) => {
      const pending = await tx.extractionReviewField.findMany({ where: pendingWhere, select: { fieldName: true } });
      reviewedFieldNames = pending.map((f) => f.fieldName);
      wasAwaitingReview = existing.extractionPending || pending.length > 0;
      const reviewed = typeof corrections === "function" ? corrections(new Set(reviewedFieldNames)) : corrections;
      return { ...reviewed, extractionPending: false, extractionConfirmedAt: reviewedAt };
    },
    alsoInTransaction: (tx) =>
      tx.extractionReviewField.updateMany({ where: pendingWhere, data: { reviewedAt, reviewedById: actorId } }),
  });
  // Who confirmed it is audit detail for admins (Settings > Security log),
  // not something the record page shows. Only a confirmation that changed
  // something is logged, so re-confirming can't flood the log.
  if (wasAwaitingReview) await logExtractionConfirmed({ ownerType: "PRODUCT", ownerId: id, actorId, fieldNames: reviewedFieldNames });
  return { id };
}

// #287 — soft-delete: see the equivalent comment on deleteContractCommand.
export async function deleteProductCommand(id: string) {
  await findProduct(id);
  await prisma.$transaction(async (tx) => {
    await tx.product.update({ where: { id }, data: { deletedAt: new Date() } });
    await syncLegacyProduct(tx, id);
  });
  revalidatePath("/products");
  revalidatePath("/dashboard");
  revalidatePath("/settings/trash");
}

export async function restoreProductCommand(id: string) {
  await findProduct(id);
  await prisma.$transaction(async (tx) => {
    await tx.product.update({ where: { id }, data: { deletedAt: null } });
    await syncLegacyProduct(tx, id);
  });
  revalidateProduct(id);
  revalidatePath("/settings/trash");
}

export async function permanentlyDeleteProductCommand(id: string) {
  await purgeProduct(id);
  revalidatePath("/settings/trash");
}

// The row-and-files part of a permanent delete, with no revalidation, so
// Trash retention (src/lib/trash.ts) can call it from a page render. Only a
// Product in Trash is deleted (deleteFromTrash, #534).
export async function purgeProduct(id: string, options: PurgeOptions = {}) {
  await findProduct(id);
  const staged = await prisma.item.findUnique({ where: { legacyProductId: id }, select: { id: true } });
  const linked = await prisma.inventoryItem.findMany({ where: { warrantyProductId: id }, select: { id: true } });
  await deleteFromTrash(
    "Warranty",
    options,
    (inTrash) => prisma.product.deleteMany({ where: { id, ...inTrash } }),
    () => prisma.product.findUnique({ where: { id }, select: { deletedAt: true } }),
  );
  try {
    // Files first, straight after the row: if clearing the log below throws,
    // the files mustn't be left orphaned with no row pointing at them (#413).
    await removeOwnerDocumentFiles("PRODUCT", id);
    // NotificationLog is polymorphic across owners (#201), so it doesn't
    // cascade with the row; clear it explicitly.
    await clearNotificationLogs("PRODUCT", id);
  } finally {
    // Product purge clears the old link. Rehome surviving Inventory items in
    // the staging tables; the legacy operation above remains authoritative.
    // In a finally (#445 review), so a failed file or log cleanup can't leave
    // a staged Item behind for a Product that no longer exists.
    await retireStagedProduct(id, staged?.id ?? null, linked.map((source) => source.id));
  }
}
