"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { productSchema } from "@/lib/validation/product";
import {
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  deleteProductDir,
  deleteProductDocument as deleteProductDocumentFile,
  saveProductDocument,
} from "@/lib/storage";
import { ProductDocumentKind } from "@/generated/prisma/enums";
import { formDataToStringValues } from "@/lib/form-state";

export type ActionState = {
  error?: string;
  success?: string;
  values?: Record<string, string>;
} | null;

const PRODUCT_FORM_FIELDS = [
  "name",
  "manufacturer",
  "vendor",
  "serialNumber",
  "barcode",
  "purchaseDate",
  "warrantyEndDate",
  "price",
  "currency",
  "notes",
  "reminderDaysBefore",
];

function firstIssueMessage(error: { issues: { message: string }[] }) {
  return error.issues[0]?.message ?? "Invalid input";
}

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in");
  if (session.user.role === "READONLY") throw new Error("Your account has read-only access.");
  return session.user;
}

function parseDocumentKind(value: FormDataEntryValue | null): ProductDocumentKind {
  const allowed = Object.values(ProductDocumentKind) as string[];
  return typeof value === "string" && allowed.includes(value)
    ? (value as ProductDocumentKind)
    : ProductDocumentKind.OTHER;
}

async function attachProductDocument(
  productId: string,
  file: File,
  kind: ProductDocumentKind,
): Promise<ActionState | null> {
  if (file.size > MAX_UPLOAD_BYTES) return { error: "File is too large (15MB max)." };
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return { error: "Unsupported file type. Use PDF, Word, or image files." };
  }

  const { storedName, size } = await saveProductDocument(productId, file);
  await prisma.productDocument.create({
    data: {
      productId,
      filename: file.name.slice(0, 255),
      storedName,
      mimeType: file.type,
      size,
      kind,
    },
  });
  return null;
}

function formToProductInput(formData: FormData) {
  return {
    name: formData.get("name"),
    manufacturer: formData.get("manufacturer"),
    vendor: formData.get("vendor"),
    serialNumber: formData.get("serialNumber"),
    barcode: formData.get("barcode"),
    purchaseDate: formData.get("purchaseDate"),
    warrantyEndDate: formData.get("warrantyEndDate"),
    price: formData.get("price"),
    currency: formData.get("currency") || "AUD",
    notes: formData.get("notes"),
    reminderDaysBefore: formData.get("reminderDaysBefore"),
  };
}

export async function createProduct(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const parsed = productSchema.safeParse(formToProductInput(formData));
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, PRODUCT_FORM_FIELDS),
    };
  }

  const invoiceFile = formData.get("invoiceFile");
  const photoFile = formData.get("photoFile");
  for (const file of [invoiceFile, photoFile]) {
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_UPLOAD_BYTES) return { error: "File is too large (15MB max)." };
      if (!ALLOWED_MIME_TYPES.has(file.type)) {
        return { error: "Unsupported file type. Use PDF, Word, or image files." };
      }
    }
  }

  const product = await prisma.product.create({
    data: { ...parsed.data, createdById: user.id },
  });

  if (invoiceFile instanceof File && invoiceFile.size > 0) {
    await attachProductDocument(product.id, invoiceFile, ProductDocumentKind.INVOICE);
  }
  if (photoFile instanceof File && photoFile.size > 0) {
    await attachProductDocument(product.id, photoFile, ProductDocumentKind.PHOTO);
  }

  revalidatePath("/products");
  revalidatePath("/dashboard");
  redirect(`/products/${product.id}`);
}

export async function updateProduct(
  productId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const parsed = productSchema.safeParse(formToProductInput(formData));
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, PRODUCT_FORM_FIELDS),
    };
  }

  const existing = await prisma.product.findUnique({ where: { id: productId } });
  if (!existing) return { error: "Product not found." };

  const warrantyEndDateChanged =
    existing.warrantyEndDate?.getTime() !== parsed.data.warrantyEndDate?.getTime();

  await prisma.$transaction([
    prisma.product.update({
      where: { id: productId },
      data: parsed.data,
    }),
    ...(warrantyEndDateChanged
      ? [prisma.productNotificationLog.deleteMany({ where: { productId } })]
      : []),
  ]);

  revalidatePath("/products");
  revalidatePath(`/products/${productId}`);
  revalidatePath("/dashboard");
  redirect(`/products/${productId}`);
}

export async function deleteProduct(productId: string): Promise<ActionState> {
  await requireUser();

  const existing = await prisma.product.findUnique({ where: { id: productId } });
  if (!existing) return { error: "Product not found." };

  await prisma.product.delete({ where: { id: productId } });
  await deleteProductDir(productId);

  revalidatePath("/products");
  revalidatePath("/dashboard");
  redirect("/products");
}

export async function addProductDocument(
  productId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }
  const kind = parseDocumentKind(formData.get("kind"));

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return { error: "Product not found." };

  const error = await attachProductDocument(productId, file, kind);
  if (error) return error;

  revalidatePath(`/products/${productId}`);
  return { success: "Document uploaded." };
}

export async function deleteProductDocumentAction(
  productId: string,
  documentId: string,
): Promise<ActionState> {
  await requireUser();

  const doc = await prisma.productDocument.findUnique({ where: { id: documentId } });
  if (!doc || doc.productId !== productId) {
    return { error: "Document not found." };
  }

  await prisma.productDocument.delete({ where: { id: documentId } });
  await deleteProductDocumentFile(productId, doc.storedName);

  revalidatePath(`/products/${productId}`);
  return { success: "Document removed." };
}
