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
  for (const warrantyId of new Set(warrantyIds)) {
    if (warrantyId) revalidatePath(`/products/${warrantyId}`);
  }
}

export async function createInventoryItemCommand(input: InventoryItemInput, actorId: string) {
  await assertModuleEnabled("INVENTORY");
  const item = await prisma.$transaction(async (tx) => {
    if (input.warrantyProductId) await assertWarrantyLive(tx, input.warrantyProductId);
    return tx.inventoryItem.create({ data: { ...input, createdById: actorId } });
  });
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
  const { item, previousWarrantyId } = await prisma.$transaction(async (tx) => {
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
    return {
      item: await findLiveParent(loadItem(), "Inventory item"),
      previousWarrantyId: existing.warrantyProductId,
    };
  });
  revalidateInventoryItem(id, [previousWarrantyId, item.warrantyProductId]);
  return item;
}

// #287 — soft delete: moves the item to Trash; its row and files stay so
// restoreInventoryItemCommand brings it back as it was. Deleting an item
// that's already in Trash is a no-op, so a repeated delete (a replayed
// offline delete, say) doesn't reset its Trash retention clock.
export async function deleteInventoryItemCommand(id: string) {
  await assertModuleEnabled("INVENTORY");
  const item = await prisma.$transaction(async (tx) => {
    const { count } = await tx.inventoryItem.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    const existing = await tx.inventoryItem.findUnique({ where: { id } });
    if (!existing) throw new RecordNotFoundError("Inventory item");
    return count > 0 ? existing : null;
  });
  if (!item) return;
  revalidateInventoryItem(id, [item.warrantyProductId]);
  revalidatePath("/settings/trash");
}

export async function restoreInventoryItemCommand(id: string) {
  await assertModuleEnabled("INVENTORY");
  const item = await prisma.$transaction(async (tx) => {
    const existing = await tx.inventoryItem.findUnique({ where: { id } });
    if (!existing) throw new RecordNotFoundError("Inventory item");
    return tx.inventoryItem.update({ where: { id }, data: { deletedAt: null } });
  });
  revalidateInventoryItem(id, [item.warrantyProductId]);
  revalidatePath("/settings/trash");
}

export async function permanentlyDeleteInventoryItemCommand(id: string) {
  await assertModuleEnabled("INVENTORY");
  await purgeInventoryItem(id);
  revalidatePath("/settings/trash");
}

// The row-and-files part of a permanent delete, with no module gate and no
// revalidation. Only for Trash retention (src/lib/trash.ts), which runs from
// a page render (where revalidatePath can't be called) and from the
// scheduler, and purges expired records whether or not the module is on.
export async function purgeInventoryItem(id: string) {
  const existing = await prisma.inventoryItem.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new RecordNotFoundError("Inventory item");
  // The row delete cascades to its Document rows; their files on disk
  // aren't FK-linked, so they're removed straight after (#413).
  await prisma.inventoryItem.delete({ where: { id } });
  await removeOwnerDocumentFiles("INVENTORY_ITEM", id);
}
