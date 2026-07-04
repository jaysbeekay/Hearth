"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { inventoryItemSchema } from "@/lib/validation/inventory";
import {
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  deleteInventoryItemDir,
  deleteInventoryItemDocument as deleteInventoryItemDocumentFile,
  saveInventoryItemDocument,
} from "@/lib/storage";
import { formDataToStringValues } from "@/lib/form-state";
import { isModuleEnabled } from "@/lib/modules/enablement";
import type { ActionState } from "@/lib/actions/auth";

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
];

function firstIssueMessage(error: { issues: { message: string }[] }) {
  return error.issues[0]?.message ?? "Invalid input";
}

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in");
  if (!(await isModuleEnabled("INVENTORY"))) throw new Error("Inventory module is disabled");
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
  };
}

async function attachDocument(inventoryItemId: string, file: File): Promise<ActionState | null> {
  if (file.size > MAX_UPLOAD_BYTES) return { error: "File is too large (15MB max)." };
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return { error: "Unsupported file type. Use PDF, Word, or image files." };
  }

  const { storedName, size } = await saveInventoryItemDocument(inventoryItemId, file);
  await prisma.inventoryItemDocument.create({
    data: {
      inventoryItemId,
      filename: file.name.slice(0, 255),
      storedName,
      mimeType: file.type,
      size,
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
    if (file.size > MAX_UPLOAD_BYTES) return { error: "File is too large (15MB max)." };
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return { error: "Unsupported file type. Use PDF, Word, or image files." };
    }
  }

  const item = await prisma.inventoryItem.create({
    data: { ...parsed.data, createdById: user.id },
  });

  if (file instanceof File && file.size > 0) {
    await attachDocument(item.id, file);
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
  if (!existing || existing.createdById !== user.id) return { error: "Item not found." };

  await prisma.inventoryItem.update({ where: { id: itemId }, data: parsed.data });

  revalidatePath("/inventory");
  revalidatePath(`/inventory/${itemId}`);
  redirect(`/inventory/${itemId}`);
}

export async function deleteInventoryItem(itemId: string): Promise<ActionState> {
  const user = await requireUser();

  const existing = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
  if (!existing || existing.createdById !== user.id) return { error: "Item not found." };

  await deleteInventoryItemDir(itemId);
  await prisma.inventoryItem.delete({ where: { id: itemId } });

  revalidatePath("/inventory");
  redirect("/inventory");
}

export async function addInventoryItemDocument(
  itemId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }

  const item = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
  if (!item || item.createdById !== user.id) return { error: "Item not found." };

  const error = await attachDocument(itemId, file);
  if (error) return error;

  revalidatePath(`/inventory/${itemId}`);
  return { success: "Document uploaded." };
}

export async function deleteInventoryItemDocumentAction(
  itemId: string,
  documentId: string,
): Promise<ActionState> {
  const user = await requireUser();

  const doc = await prisma.inventoryItemDocument.findUnique({ where: { id: documentId } });
  if (!doc || doc.inventoryItemId !== itemId) return { error: "Document not found." };

  const item = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
  if (!item || item.createdById !== user.id) return { error: "Item not found." };

  await prisma.inventoryItemDocument.delete({ where: { id: documentId } });
  await deleteInventoryItemDocumentFile(itemId, doc.storedName);

  revalidatePath(`/inventory/${itemId}`);
  return { success: "Document removed." };
}
