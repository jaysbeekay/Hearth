"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { formToInventoryItemInput } from "@/lib/formMappers";
import { fullFormUpdate } from "@/lib/validation/fullFormUpdate";
import { inventoryItemSchema } from "@/lib/validation/inventory";
import { addDocumentCommand } from "@/lib/commands/documents";
import {
  createInventoryItemCommand,
  deleteInventoryItemCommand,
  permanentlyDeleteInventoryItemCommand,
  PurgeFilesPendingError,
  restoreInventoryItemCommand,
  updateInventoryItemCommand,
} from "@/lib/commands/inventory";
import { RecordNotFoundError, RecordValidationError, StaleEditError } from "@/lib/commands/shared";
import { formDataToStringValues } from "@/lib/form-state";
import { isModuleEnabled } from "@/lib/modules/enablement";
import type { ActionState } from "@/lib/actions/auth";
import { describeUploadRejection } from "@/lib/uploadValidation";
import { parseDocumentCategory } from "@/lib/documents/categories";
import { itemCutoverReadiness } from "@/lib/items/cutoverReadiness";
import { issueState } from "@/lib/validation/issues";

const INVENTORY_ITEM_FORM_FIELDS = [
  "label",
  "category",
  "brand",
  "model",
  "serialNumber",
  "purchaseDate",
  "purchasePrice",
  "currency",
  "location",
  "notes",
  "warrantyRegistered",
  "warrantyExtended",
  "warrantyProductId",
];


async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in");
  if (!(await isModuleEnabled("INVENTORY"))) throw new Error("Inventory module is disabled");
  if (session.user.role === "READONLY") throw new Error("Your account has read-only access.");
  return session.user;
}

async function createInventoryItemWithDestination(
  _prevState: ActionState,
  formData: FormData,
  itemRoute: boolean,
): Promise<ActionState> {
  const user = await requireUser();

  const parsed = inventoryItemSchema.safeParse(formToInventoryItemInput(formData));
  if (!parsed.success) {
    return {
      ...issueState(parsed.error),
      values: formDataToStringValues(formData, INVENTORY_ITEM_FORM_FIELDS),
    };
  }

  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    const rejection = await describeUploadRejection(file);
    if (rejection) return { error: rejection };
  }

  // The command refuses a link to a warranty that's missing or in Trash
  // (#471); any other failure is a real error, not a warranty problem.
  let item;
  try {
    item = await createInventoryItemCommand(parsed.data, user.id);
  } catch (error) {
    if (error instanceof RecordValidationError) {
      return { error: error.message, values: formDataToStringValues(formData, INVENTORY_ITEM_FORM_FIELDS) };
    }
    throw error;
  }

  if (file instanceof File && file.size > 0) {
    await addDocumentCommand("INVENTORY_ITEM", item.id, {
      file,
      category: parseDocumentCategory(formData.get("documentCategory")),
    });
  }

  if (itemRoute && process.env.ITEMS_PREVIEW === "1" && (await itemCutoverReadiness()).ready) {
    const mapping = await prisma.itemLegacyInventory.findUnique({ where: { inventoryItemId: item.id } });
    if (mapping) redirect(`/items/${mapping.itemId}`);
  }
  redirect(`/inventory/${item.id}`);
}

export async function createInventoryItem(state: ActionState, formData: FormData): Promise<ActionState> {
  return createInventoryItemWithDestination(state, formData, false);
}

/** The Item preview uses the existing canonical Inventory write transaction. */
export async function createCatalogItem(state: ActionState, formData: FormData): Promise<ActionState> {
  return createInventoryItemWithDestination(state, formData, true);
}

async function updateInventoryItemWithDestination(
  itemId: string,
  _prevState: ActionState,
  formData: FormData,
  itemRoute: boolean,
): Promise<ActionState> {
  const user = await requireUser();

  const parsed = inventoryItemSchema.safeParse(formToInventoryItemInput(formData));
  if (!parsed.success) {
    return {
      ...issueState(parsed.error),
      values: formDataToStringValues(formData, INVENTORY_ITEM_FORM_FIELDS),
    };
  }

  // The command refuses an item in Trash as not found (#446).
  try {
    await updateInventoryItemCommand(itemId, fullFormUpdate(inventoryItemSchema, parsed.data, formData), user.id);
  } catch (error) {
    if (error instanceof RecordNotFoundError) return { error: "Item not found." };
    if (error instanceof StaleEditError || error instanceof RecordValidationError) {
      return { error: error.message, values: formDataToStringValues(formData, INVENTORY_ITEM_FORM_FIELDS) };
    }
    throw error;
  }

  if (itemRoute && process.env.ITEMS_PREVIEW === "1" && (await itemCutoverReadiness()).ready) {
    const mapping = await prisma.itemLegacyInventory.findUnique({ where: { inventoryItemId: itemId } });
    if (mapping) {
      revalidatePath(`/items/${mapping.itemId}`);
      redirect(`/items/${mapping.itemId}`);
    }
  }
  redirect(`/inventory/${itemId}`);
}

export async function updateInventoryItem(itemId: string, state: ActionState, formData: FormData): Promise<ActionState> {
  return updateInventoryItemWithDestination(itemId, state, formData, false);
}

export async function updateCatalogItem(itemId: string, state: ActionState, formData: FormData): Promise<ActionState> {
  return updateInventoryItemWithDestination(itemId, state, formData, true);
}

// #287 — soft-delete: see the equivalent comment on deleteContract (contracts.ts).
// Deleting an item that's already in Trash is a no-op (#471).
export async function deleteInventoryItem(itemId: string): Promise<ActionState> {
  await requireUser();
  try {
    await deleteInventoryItemCommand(itemId);
  } catch (error) {
    if (error instanceof RecordNotFoundError) return { error: "Item not found." };
    throw error;
  }
  redirect("/inventory");
}

export async function restoreInventoryItem(itemId: string): Promise<ActionState> {
  await requireUser();
  try {
    await restoreInventoryItemCommand(itemId);
  } catch (error) {
    if (error instanceof RecordNotFoundError) return { error: "Item not found." };
    throw error;
  }
  return { success: "Restored." };
}

export async function permanentlyDeleteInventoryItem(itemId: string): Promise<ActionState> {
  await requireUser();
  try {
    await permanentlyDeleteInventoryItemCommand(itemId);
  } catch (error) {
    // The item is gone; only its files are left for the scheduled cleanup.
    if (error instanceof PurgeFilesPendingError) {
      return { success: "Deleted permanently. Its files will be cleaned up shortly." };
    }
    if (error instanceof RecordNotFoundError) return { error: "Item not found." };
    if (error instanceof RecordValidationError) return { error: error.message };
    throw error;
  }
  return { success: "Deleted permanently." };
}
