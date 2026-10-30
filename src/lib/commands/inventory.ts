import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { assertModuleEnabled } from "@/lib/modules/enablement";
import {
  updateLiveUnlessStale,
  findLiveParent,
  isLive,
  RecordNotFoundError,
  RecordValidationError,
  type UpdateOptions,
} from "@/lib/commands/shared";
import type { ClearablePatch } from "@/lib/validation/fullFormUpdate";
import type { InventoryItemInput } from "@/lib/validation/inventory";

// Record commands for Inventory items (ADR 0003). Updates go through here,
// from the edit form's server action and the offline sync handler (#446).
// Callers own sign-in, role checks and Zod parsing; these own the module
// gate, the write and revalidation.
//
// An Inventory item in Trash is read-only until it's restored (#428, the
// rules in shared.ts): an update to it is refused as not found, as its
// pages already 404.

// Partial patch: keys left out (or undefined) are not written, and a `null`
// clears the field. The edit form sends fullFormUpdate()'s patch, where
// every field it submitted blank is `null` (#413).
//
// A warranty link the item doesn't already have must be to a live Product;
// one it already has is kept even if that Product has since gone to Trash,
// so the rest of the item can still be edited. The check and the write run
// in one transaction, using only `tx` (see shared.ts).
export async function updateInventoryItemCommand(
  id: string,
  patch: ClearablePatch<InventoryItemInput>,
  actorId: string,
  options: UpdateOptions = {},
) {
  await assertModuleEnabled("INVENTORY");
  await prisma.$transaction(async (tx) => {
    const loadItem = () => tx.inventoryItem.findUnique({ where: { id } });
    const existing = await findLiveParent(loadItem(), "Inventory item");
    if (patch.warrantyProductId && patch.warrantyProductId !== existing.warrantyProductId) {
      const warranty = await tx.product.findUnique({
        where: { id: patch.warrantyProductId },
        select: { deletedAt: true },
      });
      if (!isLive(warranty)) throw new RecordValidationError("That warranty doesn't exist or is in Trash.");
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
  });
  revalidatePath("/inventory");
  revalidatePath(`/inventory/${id}`);
  const item = await prisma.inventoryItem.findUnique({ where: { id } });
  if (!item) throw new RecordNotFoundError("Inventory item");
  return item;
}
