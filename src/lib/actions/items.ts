"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/actions/auth";
import { addDocumentAction } from "@/lib/actions/documents";
import { itemCutoverReadiness } from "@/lib/items/cutoverReadiness";
import { prisma } from "@/lib/prisma";

/** Item uploads use a canonical legacy owner until shared Document cutover. */
export async function addItemDocumentAction(itemId: string, state: ActionState, formData: FormData): Promise<ActionState> {
  if (process.env.ITEMS_PREVIEW !== "1" || !(await itemCutoverReadiness()).ready) return { error: "Items are not ready yet." };
  const item = await prisma.item.findUnique({ where: { id: itemId }, include: { legacyInventories: true } });
  if (!item || item.deletedAt) return { error: "Item not found." };
  const source = item.legacyProductId
    ? { kind: "PRODUCT" as const, ownerId: item.legacyProductId }
    : item.legacyInventories[0]
      ? { kind: "INVENTORY_ITEM" as const, ownerId: item.legacyInventories[0].inventoryItemId }
      : null;
  if (!source) return { error: "Item has no writable source." };
  const result = await addDocumentAction(source.kind, source.ownerId, state, formData);
  if (result?.success) revalidatePath(`/items/${itemId}`);
  return result;
}
