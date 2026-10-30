"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { formToInventoryItemInput } from "@/lib/formMappers";
import { prisma } from "@/lib/prisma";
import { fullFormUpdate } from "@/lib/validation/fullFormUpdate";
import { inventoryItemSchema } from "@/lib/validation/inventory";
import { addDocumentCommand, removeOwnerDocumentFiles } from "@/lib/commands/documents";
import { updateInventoryItemCommand } from "@/lib/commands/inventory";
import { RecordNotFoundError, RecordValidationError, StaleEditError } from "@/lib/commands/shared";
import { formDataToStringValues } from "@/lib/form-state";
import { isModuleEnabled } from "@/lib/modules/enablement";
import type { ActionState } from "@/lib/actions/auth";
import { describeUploadRejection } from "@/lib/uploadValidation";
import { parseDocumentCategory } from "@/lib/documents/categories";

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

function firstIssueMessage(error: { issues: { message: string }[] }) {
  return error.issues[0]?.message ?? "Invalid input";
}

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in");
  if (!(await isModuleEnabled("INVENTORY"))) throw new Error("Inventory module is disabled");
  if (session.user.role === "READONLY") throw new Error("Your account has read-only access.");
  return session.user;
}

export async function createInventoryItem(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const parsed = inventoryItemSchema.safeParse(formToInventoryItemInput(formData));
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, INVENTORY_ITEM_FORM_FIELDS),
    };
  }

  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    const rejection = await describeUploadRejection(file);
    if (rejection) return { error: rejection };
  }

  let item;
  try {
    item = await prisma.inventoryItem.create({
      data: { ...parsed.data, createdById: user.id },
    });
  } catch {
    return { error: "Linked warranty no longer exists.", values: formDataToStringValues(formData, INVENTORY_ITEM_FORM_FIELDS) };
  }

  if (file instanceof File && file.size > 0) {
    await addDocumentCommand("INVENTORY_ITEM", item.id, {
      file,
      category: parseDocumentCategory(formData.get("documentCategory")),
    });
  }

  revalidatePath("/inventory");
  redirect(`/inventory/${item.id}`);
}

export async function updateInventoryItem(
  itemId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const parsed = inventoryItemSchema.safeParse(formToInventoryItemInput(formData));
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
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

  redirect(`/inventory/${itemId}`);
}

// #287 — soft-delete: see the equivalent comment on deleteContract (contracts.ts).
export async function deleteInventoryItem(itemId: string): Promise<ActionState> {
  await requireUser();

  const existing = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
  if (!existing) return { error: "Item not found." };

  await prisma.inventoryItem.update({ where: { id: itemId }, data: { deletedAt: new Date() } });

  revalidatePath("/inventory");
  revalidatePath("/settings/trash");
  redirect("/inventory");
}

export async function restoreInventoryItem(itemId: string): Promise<ActionState> {
  await requireUser();

  const existing = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
  if (!existing) return { error: "Item not found." };

  await prisma.inventoryItem.update({ where: { id: itemId }, data: { deletedAt: null } });

  revalidatePath("/inventory");
  revalidatePath("/settings/trash");
  return { success: "Restored." };
}

export async function permanentlyDeleteInventoryItem(itemId: string): Promise<ActionState> {
  await requireUser();

  const existing = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
  if (!existing) return { error: "Item not found." };

  await removeOwnerDocumentFiles("INVENTORY_ITEM", itemId);
  await prisma.inventoryItem.delete({ where: { id: itemId } });

  revalidatePath("/settings/trash");
  return { success: "Deleted permanently." };
}

