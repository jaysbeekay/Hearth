"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { productSchema } from "@/lib/validation/product";
import {
  deleteProductDocument as deleteProductDocumentFile,
  saveProductDocument,
} from "@/lib/storage";
import { ProductDocumentKind } from "@/generated/prisma/enums";
import { formDataToStringValues } from "@/lib/form-state";
import { formToProductInput } from "@/lib/formMappers";
import { queueDocumentExtraction } from "@/lib/documents/queueExtraction";
import { describeUploadRejection } from "@/lib/uploadValidation";
import { extractionFieldsFromForm } from "@/lib/documents/extractionConfirmation";
import { saveExtractionReviewFieldsFromForm, reviewAndConfirmExtraction } from "@/lib/documents/extractionReview";
import { saveFileToInboxFallback } from "@/lib/documents/inboxFallback";
import { parseDocumentCategory } from "@/lib/documents/categories";
import {
  createProductCommand,
  updateProductCommand,
  deleteProductCommand,
  restoreProductCommand,
  permanentlyDeleteProductCommand,
} from "@/lib/commands/products";

export type ActionState = {
  error?: string;
  success?: string;
  values?: Record<string, string>;
} | null;

const PRODUCT_FORM_FIELDS = [
  "description",
  "manufacturer",
  "model",
  "vendor",
  "serialNumber",
  "barcode",
  "purchaseDate",
  "warrantyEndDate",
  "price",
  "currency",
  "notes",
  "reminderDaysBefore",
  "propertyId",
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
  category: string | null = null,
): Promise<ActionState | null> {
  const rejection = await describeUploadRejection(file);
  if (rejection) return { error: rejection };

  const { storedName, size, sha256, mimeType } = await saveProductDocument(productId, file);
  // Only invoices carry meaningful text; skip OCR on plain product photos.
  const document = await prisma.productDocument.create({
    data: {
      productId,
      filename: file.name.slice(0, 255),
      storedName,
      mimeType,
      size,
      kind,
      extractionStatus: kind === ProductDocumentKind.INVOICE ? "PENDING" : "COMPLETED",
      sha256,
      category,
    },
  });
  if (kind === ProductDocumentKind.INVOICE) await queueDocumentExtraction({ kind: "product", id: document.id, ownerId: productId, storedName, mimeType });
  return null;
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
      const rejection = await describeUploadRejection(file);
      if (rejection) return { error: rejection };
    }
  }

  const product = await createProductCommand({ ...parsed.data, ...extractionFieldsFromForm(formData) }, user.id);
  await saveExtractionReviewFieldsFromForm("PRODUCT", product.id, formData);

  let docFallback: "inbox" | "failed" | null = null;
  if (invoiceFile instanceof File && invoiceFile.size > 0) {
    const result = await attachProductDocument(
      product.id,
      invoiceFile,
      ProductDocumentKind.INVOICE,
      parseDocumentCategory(formData.get("documentCategory")) ?? "INVOICE",
    );
    if (result?.error) {
      const fallback = await saveFileToInboxFallback(invoiceFile, user.id);
      docFallback = fallback ? "inbox" : "failed";
    }
  }
  if (photoFile instanceof File && photoFile.size > 0) {
    const result = await attachProductDocument(product.id, photoFile, ProductDocumentKind.PHOTO, "PHOTO");
    if (result?.error) {
      const fallback = await saveFileToInboxFallback(photoFile, user.id);
      docFallback = fallback ? "inbox" : (docFallback ?? "failed");
    }
  }

  redirect(`/products/${product.id}${docFallback ? `?docFallback=${docFallback}` : ""}`);
}

export async function updateProduct(
  productId: string,
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

  try {
    await updateProductCommand(
      productId,
      { ...parsed.data, ...extractionFieldsFromForm(formData) },
      user.id,
    );
    await saveExtractionReviewFieldsFromForm("PRODUCT", productId, formData);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Product not found." };
  }
  redirect(`/products/${productId}`);
}

/**
 * Standalone confirm action for the detail page's DetailStatusBanner — see
 * the equivalent confirmContractExtraction in contracts.ts (#200).
 */
export async function confirmProductExtraction(productId: string): Promise<ActionState> {
  const user = await requireUser();

  const existing = await prisma.product.findUnique({ where: { id: productId } });
  if (!existing) return { error: "Product not found." };

  const reviewedAt = new Date();
  await prisma.$transaction([
    prisma.product.update({
      where: { id: productId },
      data: { extractionPending: false, extractionConfirmedAt: reviewedAt, updatedById: user.id },
    }),
    prisma.extractionReviewField.updateMany({
      where: { ownerType: "PRODUCT", ownerId: productId, reviewedAt: null },
      data: { reviewedAt, reviewedById: user.id },
    }),
  ]);

  revalidatePath(`/products/${productId}`);
  revalidatePath("/dashboard");
  return { success: "Details confirmed." };
}

/**
 * Field-level review counterpart to confirmProductExtraction (#331) — see
 * the equivalent reviewContractExtraction in contracts.ts.
 */
export async function reviewProductExtraction(
  productId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const result = await reviewAndConfirmExtraction("PRODUCT", productId, user.id, formData);
  if (result.error) return { error: result.error };

  revalidatePath(`/products/${productId}`);
  revalidatePath("/dashboard");
  return { success: "Details confirmed." };
}

export type AssistantActionResult =
  | { success: true; productId: string }
  | { success: false; error: string };

// Counterparts to createProduct/updateProduct for the AI Assistant's
// guarded-write flow (see src/lib/chat/tools.ts) — same requireUser() gate
// and productSchema validation as the real forms, but returns a plain
// result instead of redirect()ing, since a chat reply shouldn't navigate the
// user away from their conversation.
export async function createProductFromAssistant(
  data: Record<string, unknown>,
): Promise<AssistantActionResult> {
  const user = await requireUser();

  const parsed = productSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: firstIssueMessage(parsed.error) };

  const product = await createProductCommand(parsed.data, user.id);
  return { success: true, productId: product.id };
}

export async function updateProductFromAssistant(
  productId: string,
  data: Record<string, unknown>,
): Promise<AssistantActionResult> {
  const user = await requireUser();

  const parsed = productSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: firstIssueMessage(parsed.error) };

  try {
    await updateProductCommand(productId, parsed.data, user.id);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Product not found." };
  }
  return { success: true, productId };
}

// #287 — soft-delete: see the equivalent comment on deleteContract.
export async function deleteProduct(productId: string): Promise<ActionState> {
  await requireUser();

  try {
    await deleteProductCommand(productId);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Product not found." };
  }
  redirect("/products");
}

export async function restoreProduct(productId: string): Promise<ActionState> {
  await requireUser();

  try {
    await restoreProductCommand(productId);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Product not found." };
  }
  return { success: "Restored." };
}

export async function permanentlyDeleteProduct(productId: string): Promise<ActionState> {
  await requireUser();

  try {
    await permanentlyDeleteProductCommand(productId);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Product not found." };
  }
  return { success: "Deleted permanently." };
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

  const error = await attachProductDocument(
    productId,
    file,
    kind,
    parseDocumentCategory(formData.get("documentCategory")),
  );
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

  await prisma.productDocument.update({ where: { id: documentId }, data: { deletedAt: new Date() } });

  revalidatePath(`/products/${productId}`);
  revalidatePath("/settings/trash");
  return { success: "Document moved to Trash." };
}

export async function restoreProductDocument(documentId: string): Promise<ActionState> {
  await requireUser();

  const doc = await prisma.productDocument.findUnique({ where: { id: documentId } });
  if (!doc) return { error: "Document not found." };

  await prisma.productDocument.update({ where: { id: documentId }, data: { deletedAt: null } });
  revalidatePath(`/products/${doc.productId}`);
  revalidatePath("/documents");
  revalidatePath("/settings/trash");
  return { success: "Restored." };
}

export async function permanentlyDeleteProductDocument(documentId: string): Promise<ActionState> {
  await requireUser();

  const doc = await prisma.productDocument.findUnique({ where: { id: documentId } });
  if (!doc) return { error: "Document not found." };

  await prisma.productDocument.delete({ where: { id: documentId } });
  await deleteProductDocumentFile(doc.productId, doc.storedName);
  revalidatePath(`/products/${doc.productId}`);
  revalidatePath("/documents");
  revalidatePath("/settings/trash");
  return { success: "Deleted permanently." };
}

export async function setProductDocumentImportant(
  productId: string,
  documentId: string,
  isImportant: boolean,
): Promise<ActionState> {
  await requireUser();

  const doc = await prisma.productDocument.findUnique({ where: { id: documentId } });
  if (!doc || doc.productId !== productId) {
    return { error: "Document not found." };
  }

  await prisma.productDocument.update({ where: { id: documentId }, data: { isImportant } });

  revalidatePath(`/products/${productId}`);
  return { success: isImportant ? "Marked as important." : "Unmarked as important." };
}
