import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { removeOwnerDocumentFiles } from "@/lib/commands/documents";
import { assertModuleEnabled } from "@/lib/modules/enablement";
import {
  updateLiveUnlessStale,
  assertNotStale,
  findLiveParent,
  isLive,
  RecordNotFoundError,
  RecordValidationError,
  type UpdateOptions,
} from "@/lib/commands/shared";
import type { ClearablePatch } from "@/lib/validation/fullFormUpdate";
import type { InventoryItemInput } from "@/lib/validation/inventory";
import { withStagedFileMoves } from "@/lib/items/stagedFileMoves";
import { purgeLegacyInventoryStage, syncLegacyInventory } from "@/lib/items/syncLegacyItem";
import type { Prisma } from "@/generated/prisma/client";

// Record commands for Inventory items (ADR 0003). Every write to
// `inventoryItem` goes through here: the server actions, import, the
// offline sync handler and Trash retention (#446, #471). Callers own
// sign-in, role checks and Zod parsing; these own the module gate, the
// write, file cleanup and revalidation.
//
// An Inventory item in Trash is read-only until it's restored (#428, the
// rules in shared.ts): an update to it is refused as not found, as its
// pages already 404. Delete, restore and permanent delete still work on it.
//
// Create, delete and restore each run their check and write in one
// prisma.$transaction, using only `tx`, so a later step that must land
// with the write (the #380 Item staging mirror) has one place to go.

// A transaction's client: every query inside the transaction must use it.
type Db = Prisma.TransactionClient;

export const WARRANTY_NOT_LIVE_MESSAGE = "That warranty doesn't exist or has been deleted.";

// A warranty link the item doesn't already have must be to a live Product.
async function assertWarrantyLive(db: Db, warrantyProductId: string) {
  const warranty = await db.product.findUnique({
    where: { id: warrantyProductId },
    select: { deletedAt: true },
  });
  if (!isLive(warranty)) throw new RecordValidationError(WARRANTY_NOT_LIVE_MESSAGE);
}

// The list, the item's page, and the Warranty pages that list linked items.
// (/wealth, which values Items, renders per request, so it needs no
// revalidation.)
function revalidateInventoryItem(id: string, warrantyIds: (string | null | undefined)[] = []) {
  revalidatePath("/inventory");
  revalidatePath(`/inventory/${id}`);
  revalidatePath("/dashboard");
  revalidatePath("/products");
  // #380 staging: the hidden Item preview lists the mirrored rows.
  revalidatePath("/items");
  for (const warrantyId of new Set(warrantyIds)) {
    if (warrantyId) revalidatePath(`/products/${warrantyId}`);
  }
}

export async function createInventoryItemCommand(
  input: InventoryItemInput,
  actorId: string,
  alsoInTransaction?: (tx: Db, created: { id: string }) => Promise<unknown>,
) {
  await assertModuleEnabled("INVENTORY");
  const item = await withStagedFileMoves(() => prisma.$transaction(async (tx) => {
    if (input.warrantyProductId) await assertWarrantyLive(tx, input.warrantyProductId);
    const created = await tx.inventoryItem.create({ data: { ...input, createdById: actorId } });
    if (alsoInTransaction) await alsoInTransaction(tx, created);
    // #380 staging: mirror into the staged Item tables in the same transaction.
    await syncLegacyInventory(tx, created.id);
    return created;
  }));
  revalidateInventoryItem(item.id, [item.warrantyProductId]);
  return item;
}

// Partial patch: keys left out (or undefined) are not written, and a `null`
// clears the field. The edit form sends fullFormUpdate()'s patch, where
// every field it submitted blank is `null` (#413).
//
// A stale edit is refused first. Then a warranty link the item doesn't
// already have must be to a live Product; one it already has is kept even
// if that Product has since gone to Trash, so the rest of the item can
// still be edited. The checks, the write and the read of the updated row
// run in one transaction, using only `tx` (see shared.ts).
export async function updateInventoryItemCommand(
  id: string,
  patch: ClearablePatch<InventoryItemInput>,
  actorId: string,
  options: UpdateOptions = {},
) {
  await assertModuleEnabled("INVENTORY");
  const { item, previousWarrantyId } = await withStagedFileMoves(() => prisma.$transaction(async (tx) => {
    const loadItem = () => tx.inventoryItem.findUnique({ where: { id } });
    const existing = await findLiveParent(loadItem(), "Inventory item");
    assertNotStale(existing, options.baseUpdatedAt);
    if (patch.warrantyProductId && patch.warrantyProductId !== existing.warrantyProductId) {
      await assertWarrantyLive(tx, patch.warrantyProductId);
    }
    await updateLiveUnlessStale(
      options.baseUpdatedAt,
      (guard) =>
        tx.inventoryItem.updateMany({
          where: { id, deletedAt: null, ...guard },
          data: { ...patch, updatedById: actorId },
        }),
      () => findLiveParent(loadItem(), "Inventory item"),
    );
    // #380 staging: mirror into the staged Item tables in the same transaction.
    await syncLegacyInventory(tx, id, existing.warrantyProductId);
    return {
      item: await findLiveParent(loadItem(), "Inventory item"),
      previousWarrantyId: existing.warrantyProductId,
    };
  }));
  revalidateInventoryItem(id, [previousWarrantyId, item.warrantyProductId]);
  return item;
}

// #287 — soft delete: moves the item to Trash; its row and files stay so
// restoreInventoryItemCommand brings it back as it was. Deleting an item
// that's already in Trash is a no-op, so a repeated delete (a replayed
// offline delete, say) doesn't reset its Trash retention clock.
export async function deleteInventoryItemCommand(id: string) {
  await assertModuleEnabled("INVENTORY");
  const item = await withStagedFileMoves(() => prisma.$transaction(async (tx) => {
    const { count } = await tx.inventoryItem.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    const existing = await tx.inventoryItem.findUnique({ where: { id } });
    if (!existing) throw new RecordNotFoundError("Inventory item");
    if (count === 0) return null;
    await syncLegacyInventory(tx, id);
    return existing;
  }));
  if (!item) return;
  revalidateInventoryItem(id, [item.warrantyProductId]);
  revalidatePath("/settings/trash");
}

export async function restoreInventoryItemCommand(id: string) {
  await assertModuleEnabled("INVENTORY");
  const item = await withStagedFileMoves(() => prisma.$transaction(async (tx) => {
    const existing = await tx.inventoryItem.findUnique({ where: { id } });
    if (!existing) throw new RecordNotFoundError("Inventory item");
    const restored = await tx.inventoryItem.update({ where: { id }, data: { deletedAt: null } });
    await syncLegacyInventory(tx, id);
    return restored;
  }));
  revalidateInventoryItem(id, [item.warrantyProductId]);
  revalidatePath("/settings/trash");
}

export async function permanentlyDeleteInventoryItemCommand(id: string) {
  await assertModuleEnabled("INVENTORY");
  await purgeInventoryItem(id);
  revalidatePath("/settings/trash");
}

/** A permanent delete refused because the item isn't in Trash (it was restored). */
export class ItemNotInTrashError extends RecordValidationError {
  constructor() {
    super("That item has been restored, so it wasn't deleted.");
    this.name = "ItemNotInTrashError";
  }
}

/**
 * The item's row (and its Document rows) are gone, but removing its files
 * failed. Not a failed delete: the document-store reconciliation (#251,
 * run by the scheduler) removes files with no row once they're stale, so
 * callers report the delete as done and the cleanup as pending.
 */
export class PurgeFilesPendingError extends Error {
  constructor(cause: unknown) {
    super("The item was deleted; its files will be removed by the next cleanup.", { cause });
    this.name = "PurgeFilesPendingError";
  }
}

export interface PurgeOptions {
  // Trash retention's cutoff: only purge the item if it went to Trash
  // before this, so one restored and deleted again mid-run keeps its new
  // Trash window.
  deletedBefore?: Date;
}

// The row-and-files part of a permanent delete, with no module gate and no
// revalidation. Trash retention (src/lib/trash.ts) calls it directly: it runs
// from a page render (where revalidatePath can't be called) and from the
// scheduler, and purges expired records whether or not the module is on.
//
// Only an item that's in Trash is purged, and the check is in the delete's
// own where clause, so a restore that lands between Trash retention listing
// the item and purging it can't be undone by the purge. A missing item is
// not found (a second purge included); an item that's live is refused with
// ItemNotInTrashError; one deleted again since `deletedBefore` returns false
// and is left alone.
export async function purgeInventoryItem(id: string, options: PurgeOptions = {}): Promise<boolean> {
  // #380 staging: the staged copies of its Documents are retired with it.
  const documentIds = (await prisma.inventoryItemDocument.findMany({ where: { inventoryItemId: id }, select: { id: true } })).map((doc) => doc.id);
  const { count } = await prisma.inventoryItem.deleteMany({
    where: { id, deletedAt: options.deletedBefore ? { lt: options.deletedBefore } : { not: null } },
  });
  if (count === 0) {
    const existing = await prisma.inventoryItem.findUnique({ where: { id }, select: { deletedAt: true } });
    if (!existing) throw new RecordNotFoundError("Inventory item");
    if (!existing.deletedAt) throw new ItemNotInTrashError();
    return false;
  }
  // Best effort, after the legacy delete: a failure is logged and
  // retireOrphanedStages (run by Trash retention) catches it later.
  try {
    await purgeLegacyInventoryStage(id, documentIds);
  } catch (error) {
    console.error("[items] couldn't retire staged Inventory item %s", id, error);
  }
  // The row delete cascades to its Document rows; their files on disk
  // aren't FK-linked, so they're removed straight after (#413). If that
  // fails, the document-store reconciliation sweeps them (#251).
  try {
    await removeOwnerDocumentFiles("INVENTORY_ITEM", id);
  } catch (error) {
    console.error("[inventory] item %s deleted, but removing its files failed; reconciliation will sweep them", id, error);
    throw new PurgeFilesPendingError(error);
  }
  return true;
}
