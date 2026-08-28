"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { inventoryItemSchema } from "@/lib/validation/inventory";
import {
  deleteInventoryItemDir,
  deleteInventoryItemDocument as deleteInventoryItemDocumentFile,
  saveInventoryItemDocument,
} from "@/lib/storage";
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

function formToInventoryItemInput(formData: FormData) {
  return {
    label: formData.get("label"),
    category: formData.get("category") || "OTHER",
    brand: formData.get("brand"),
    model: formData.get("model"),
    serialNumber: formData.get("serialNumber"),
    purchaseDate: formData.get("purchaseDate"),
    purchasePrice: formData.get("purchasePrice"),
    currency: formData.get("currency") || "AUD",
    location: formData.get("location"),
    notes: formData.get("notes"),
    warrantyRegistered: formData.get("warrantyRegistered") === "on",
    warrantyExtended: formData.get("warrantyExtended") === "on",
    warrantyProductId: formData.get("warrantyProductId"),
  };
}

async function attachDocument(
  inventoryItemId: string,
  file: File,
  category: string | null = null,
): Promise<ActionState | null> {
  const rejection = await describeUploadRejection(file);
  if (rejection) return { error: rejection };

  const { storedName, size, sha256, mimeType } = await saveInventoryItemDocument(inventoryItemId, file);
  await prisma.inventoryItemDocument.create({
    data: {
      inventoryItemId,
      filename: file.name.slice(0, 255),
      storedName,
      mimeType,
      size,
      sha256,
      category,
    },
  });
  return null;
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
    await attachDocument(item.id, file, parseDocumentCategory(formData.get("documentCategory")));
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

  const existing = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
  if (!existing) return { error: "Item not found." };

  try {
    await prisma.inventoryItem.update({ where: { id: itemId }, data: { ...parsed.data, updatedById: user.id } });
  } catch {
    return { error: "Linked warranty no longer exists.", values: formDataToStringValues(formData, INVENTORY_ITEM_FORM_FIELDS) };
  }

  revalidatePath("/inventory");
  revalidatePath(`/inventory/${itemId}`);
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

  await deleteInventoryItemDir(itemId);
  await prisma.inventoryItem.delete({ where: { id: itemId } });

  revalidatePath("/settings/trash");
  return { success: "Deleted permanently." };
}

export async function addInventoryItemDocument(
  itemId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }

  const item = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
  if (!item) return { error: "Item not found." };

  const error = await attachDocument(itemId, file, parseDocumentCategory(formData.get("documentCategory")));
  if (error) return error;

  revalidatePath(`/inventory/${itemId}`);
  return { success: "Document uploaded." };
}

export async function deleteInventoryItemDocumentAction(
  itemId: string,
  documentId: string,
): Promise<ActionState> {
  await requireUser();

  const doc = await prisma.inventoryItemDocument.findUnique({ where: { id: documentId } });
  if (!doc || doc.inventoryItemId !== itemId) return { error: "Document not found." };

  const item = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
  if (!item) return { error: "Item not found." };

  await prisma.inventoryItemDocument.update({ where: { id: documentId }, data: { deletedAt: new Date() } });

  revalidatePath(`/inventory/${itemId}`);
  revalidatePath("/settings/trash");
  return { success: "Document moved to Trash." };
}

export async function restoreInventoryItemDocument(documentId: string): Promise<ActionState> {
  await requireUser();

  const doc = await prisma.inventoryItemDocument.findUnique({ where: { id: documentId } });
  if (!doc) return { error: "Document not found." };

  await prisma.inventoryItemDocument.update({ where: { id: documentId }, data: { deletedAt: null } });
  revalidatePath(`/inventory/${doc.inventoryItemId}`);
  revalidatePath("/documents");
  revalidatePath("/settings/trash");
  return { success: "Restored." };
}

export async function permanentlyDeleteInventoryItemDocument(documentId: string): Promise<ActionState> {
  await requireUser();

  const doc = await prisma.inventoryItemDocument.findUnique({ where: { id: documentId } });
  if (!doc) return { error: "Document not found." };

  await prisma.inventoryItemDocument.delete({ where: { id: documentId } });
  await deleteInventoryItemDocumentFile(doc.inventoryItemId, doc.storedName);
  revalidatePath(`/inventory/${doc.inventoryItemId}`);
  revalidatePath("/documents");
  revalidatePath("/settings/trash");
  return { success: "Deleted permanently." };
}
