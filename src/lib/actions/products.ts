"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { productSchema } from "@/lib/validation/product";
import { fullFormUpdate } from "@/lib/validation/fullFormUpdate";
import { ProductDocumentKind } from "@/generated/prisma/enums";
import { formDataToStringValues } from "@/lib/form-state";
import { formToProductInput } from "@/lib/formMappers";
import { addDocumentCommand } from "@/lib/commands/documents";
import { describeUploadRejection, UploadRejectedError } from "@/lib/uploadValidation";
import { extractionFieldsFromForm } from "@/lib/documents/extractionConfirmation";
import {
  saveExtractionReviewFieldsFromForm,
  productReviewCorrectionsFromForm,
} from "@/lib/documents/extractionReview";
import { saveFileToInboxFallback } from "@/lib/documents/inboxFallback";
import { parseDocumentCategory } from "@/lib/documents/categories";
import {
  createProductCommand,
  updateProductCommand,
  confirmProductExtractionCommand,
  deleteProductCommand,
  restoreProductCommand,
  permanentlyDeleteProductCommand,
} from "@/lib/commands/products";
import { RecordNotFoundError, RecordValidationError, StaleEditError } from "@/lib/commands/shared";
import { linkedRecordError } from "@/lib/commands/links";

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

// Turns a command's not-found / stale-edit error into the ActionState the
// caller shows; anything else is unexpected and rethrown.
function commandError(error: unknown): { error: string } {
  if (error instanceof RecordNotFoundError) return { error: "Warranty not found." };
  if (error instanceof StaleEditError || error instanceof RecordValidationError) return { error: error.message };
  throw error;
}

// For the Assistant's actions, which return a result the chat shows rather
// than throwing: a command error keeps its message, and anything unexpected
// is logged here and reported generically, never as the raw error.
function assistantFailure(error: unknown): { success: false; error: string } {
  try {
    return { success: false, ...commandError(error) };
  } catch (unexpected) {
    console.error("[assistant] product write failed:", unexpected);
    return { success: false, error: "Couldn't save that change." };
  }
}

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in");
  if (session.user.role === "READONLY") throw new Error("Your account has read-only access.");
  return session.user;
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
    try {
      await addDocumentCommand("PRODUCT", product.id, {
        file: invoiceFile,
        productKind: ProductDocumentKind.INVOICE,
        category: parseDocumentCategory(formData.get("documentCategory")) ?? "INVOICE",
      });
    } catch (error) {
      if (!(error instanceof UploadRejectedError)) throw error;
      const fallback = await saveFileToInboxFallback(invoiceFile, user.id);
      docFallback = fallback ? "inbox" : "failed";
    }
  }
  if (photoFile instanceof File && photoFile.size > 0) {
    try {
      await addDocumentCommand("PRODUCT", product.id, {
        file: photoFile,
        productKind: ProductDocumentKind.PHOTO,
        category: "PHOTO",
      });
    } catch (error) {
      if (!(error instanceof UploadRejectedError)) throw error;
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
      { ...fullFormUpdate(productSchema, parsed.data, formData), ...extractionFieldsFromForm(formData) },
      user.id,
    );
    await saveExtractionReviewFieldsFromForm("PRODUCT", productId, formData);
  } catch (error) {
    return commandError(error);
  }
  redirect(`/products/${productId}`);
}

/**
 * Standalone confirm action for the detail page's DetailStatusBanner — see
 * the equivalent confirmContractExtraction in contracts.ts (#200).
 */
export async function confirmProductExtraction(productId: string): Promise<ActionState> {
  const user = await requireUser();

  try {
    await confirmProductExtractionCommand(productId, {}, user.id);
  } catch (error) {
    return commandError(error);
  }
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

  try {
    await confirmProductExtractionCommand(productId, productReviewCorrectionsFromForm(formData), user.id);
  } catch (error) {
    return commandError(error);
  }
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

  const linkError = await linkedRecordError(parsed.data);
  if (linkError) return { success: false, error: linkError };

  try {
    const product = await createProductCommand(parsed.data, user.id);
    return { success: true, productId: product.id };
  } catch (error) {
    return assistantFailure(error);
  }
}

export async function updateProductFromAssistant(
  productId: string,
  data: Record<string, unknown>,
): Promise<AssistantActionResult> {
  const user = await requireUser();

  const parsed = productSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: firstIssueMessage(parsed.error) };

  const linkError = await linkedRecordError(parsed.data);
  if (linkError) return { success: false, error: linkError };

  try {
    await updateProductCommand(productId, parsed.data, user.id);
  } catch (error) {
    return assistantFailure(error);
  }
  return { success: true, productId };
}

// #287 — soft-delete: see the equivalent comment on deleteContract.
export async function deleteProduct(productId: string): Promise<ActionState> {
  await requireUser();

  try {
    await deleteProductCommand(productId);
  } catch (error) {
    return commandError(error);
  }
  redirect("/products");
}

export async function restoreProduct(productId: string): Promise<ActionState> {
  await requireUser();

  try {
    await restoreProductCommand(productId);
  } catch (error) {
    return commandError(error);
  }
  return { success: "Restored." };
}

export async function permanentlyDeleteProduct(productId: string): Promise<ActionState> {
  await requireUser();

  try {
    await permanentlyDeleteProductCommand(productId);
  } catch (error) {
    return commandError(error);
  }
  return { success: "Deleted permanently." };
}

