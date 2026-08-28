"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { contractSchema } from "@/lib/validation/contract";
import {
  deleteDocument as deleteDocumentFile,
  saveDocument,
} from "@/lib/storage";
import { formDataToStringValues } from "@/lib/form-state";
import { formToContractInput } from "@/lib/formMappers";
import { queueDocumentExtraction } from "@/lib/documents/queueExtraction";
import { describeUploadRejection } from "@/lib/uploadValidation";
import { extractionFieldsFromForm } from "@/lib/documents/extractionConfirmation";
import {
  saveExtractionReviewFieldsFromForm,
} from "@/lib/documents/extractionReview";
import { saveFileToInboxFallback } from "@/lib/documents/inboxFallback";
import { parseDocumentCategory } from "@/lib/documents/categories";
import {
  createContractCommand,
  updateContractCommand,
  deleteContractCommand,
  restoreContractCommand,
  permanentlyDeleteContractCommand,
} from "@/lib/commands/contracts";

export type ActionState = {
  error?: string;
  success?: string;
  values?: Record<string, string>;
} | null;

const CONTRACT_FORM_FIELDS = [
  "title",
  "category",
  "provider",
  "contractNumber",
  "startDate",
  "endDate",
  "renewalType",
  "noticePeriodDays",
  "cost",
  "currency",
  "billingFrequency",
  "status",
  "contactName",
  "contactPhone",
  "contactEmail",
  "notes",
  "reminderDaysBefore",
  "isTaxDeductible",
  "propertyId",
  "vehicleId",
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

async function attachDocument(
  contractId: string,
  file: File,
  category: string | null = null,
): Promise<ActionState | null> {
  const rejection = await describeUploadRejection(file);
  if (rejection) return { error: rejection };

  const { storedName, size, sha256, mimeType } = await saveDocument(contractId, file);
  const document = await prisma.document.create({
    data: {
      contractId,
      filename: file.name.slice(0, 255),
      storedName,
      mimeType,
      size,
      extractionStatus: "PENDING",
      sha256,
      category,
    },
  });
  await queueDocumentExtraction({ kind: "contract", id: document.id, ownerId: contractId, storedName, mimeType });
  return null;
}

export async function createContract(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const parsed = contractSchema.safeParse(formToContractInput(formData));
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, CONTRACT_FORM_FIELDS),
    };
  }

  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    const rejection = await describeUploadRejection(file);
    if (rejection) return { error: rejection };
  }

  const contract = await createContractCommand({ ...parsed.data, ...extractionFieldsFromForm(formData) }, user.id);
  await saveExtractionReviewFieldsFromForm("CONTRACT", contract.id, formData);

  let docFallback: "inbox" | "failed" | null = null;
  if (file instanceof File && file.size > 0) {
    const attachResult = await attachDocument(contract.id, file, parseDocumentCategory(formData.get("documentCategory")));
    if (attachResult?.error) {
      const fallback = await saveFileToInboxFallback(file, user.id);
      docFallback = fallback ? "inbox" : "failed";
    }
  }

  redirect(`/contracts/${contract.id}${docFallback ? `?docFallback=${docFallback}` : ""}`);
}

export async function updateContract(
  contractId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const parsed = contractSchema.safeParse(formToContractInput(formData));
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, CONTRACT_FORM_FIELDS),
    };
  }

  try {
    await updateContractCommand(
      contractId,
      { ...parsed.data, ...extractionFieldsFromForm(formData) },
      user.id,
    );
    await saveExtractionReviewFieldsFromForm("CONTRACT", contractId, formData);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Contract not found." };
  }
  redirect(`/contracts/${contractId}`);
}

/**
 * Standalone confirm action for the detail page's DetailStatusBanner —
 * clears extractionPending without reopening the edit form, for the case
 * where a user reviews the already-saved values in place (#200).
 */
export async function confirmContractExtraction(contractId: string): Promise<ActionState> {
  const user = await requireUser();

  const existing = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!existing) return { error: "Contract not found." };

  const reviewedAt = new Date();
  await prisma.$transaction([
    prisma.contract.update({
      where: { id: contractId },
      data: { extractionPending: false, extractionConfirmedAt: reviewedAt, updatedById: user.id },
    }),
    prisma.extractionReviewField.updateMany({
      where: { ownerType: "CONTRACT", ownerId: contractId, reviewedAt: null },
      data: { reviewedAt, reviewedById: user.id },
    }),
  ]);

  revalidatePath(`/contracts/${contractId}`);
  revalidatePath("/dashboard");
  return { success: "Details confirmed." };
}

export type AssistantActionResult =
  | { success: true; contractId: string }
  | { success: false; error: string };

// Counterparts to createContract/updateContract for the AI Assistant's
// guarded-write flow (see src/lib/chat/tools.ts) — same requireUser() gate
// and contractSchema validation as the real forms, but returns a plain
// result instead of redirect()ing, since a chat reply shouldn't navigate the
// user away from their conversation.
export async function createContractFromAssistant(
  data: Record<string, unknown>,
): Promise<AssistantActionResult> {
  const user = await requireUser();

  const parsed = contractSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: firstIssueMessage(parsed.error) };

  const contract = await createContractCommand(parsed.data, user.id);
  return { success: true, contractId: contract.id };
}

export async function updateContractFromAssistant(
  contractId: string,
  data: Record<string, unknown>,
): Promise<AssistantActionResult> {
  const user = await requireUser();

  const parsed = contractSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: firstIssueMessage(parsed.error) };

  try {
    await updateContractCommand(contractId, parsed.data, user.id);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Contract not found." };
  }
  return { success: true, contractId };
}

// #287 — soft-delete: moves the contract to Trash instead of removing it.
// Files and the DB row stay intact so restoreContract can bring it back
// exactly as it was; permanentlyDeleteContract (reachable only from Trash)
// does the actual cleanup this used to do unconditionally.
export async function deleteContract(contractId: string): Promise<ActionState> {
  await requireUser();

  try {
    await deleteContractCommand(contractId);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Contract not found." };
  }
  redirect("/contracts");
}

export async function restoreContract(contractId: string): Promise<ActionState> {
  await requireUser();

  try {
    await restoreContractCommand(contractId);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Contract not found." };
  }
  return { success: "Restored." };
}

export async function permanentlyDeleteContract(contractId: string): Promise<ActionState> {
  await requireUser();

  try {
    await permanentlyDeleteContractCommand(contractId);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Contract not found." };
  }
  return { success: "Deleted permanently." };
}

export async function addDocument(
  contractId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }

  const contract = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!contract) return { error: "Contract not found." };

  const error = await attachDocument(contractId, file, parseDocumentCategory(formData.get("documentCategory")));
  if (error) return error;

  revalidatePath(`/contracts/${contractId}`);
  return { success: "Document uploaded." };
}

export async function deleteDocumentAction(
  contractId: string,
  documentId: string,
): Promise<ActionState> {
  await requireUser();

  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc || doc.contractId !== contractId) {
    return { error: "Document not found." };
  }

  await prisma.document.update({ where: { id: documentId }, data: { deletedAt: new Date() } });

  revalidatePath(`/contracts/${contractId}`);
  revalidatePath("/settings/trash");
  return { success: "Document moved to Trash." };
}

export async function restoreDocument(documentId: string): Promise<ActionState> {
  await requireUser();

  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) return { error: "Document not found." };

  await prisma.document.update({ where: { id: documentId }, data: { deletedAt: null } });
  revalidatePath(`/contracts/${doc.contractId}`);
  revalidatePath("/documents");
  revalidatePath("/settings/trash");
  return { success: "Restored." };
}

export async function permanentlyDeleteDocument(documentId: string): Promise<ActionState> {
  await requireUser();

  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) return { error: "Document not found." };

  await prisma.document.delete({ where: { id: documentId } });
  await deleteDocumentFile(doc.contractId, doc.storedName);
  revalidatePath(`/contracts/${doc.contractId}`);
  revalidatePath("/documents");
  revalidatePath("/settings/trash");
  return { success: "Deleted permanently." };
}

export async function setDocumentImportant(
  contractId: string,
  documentId: string,
  isImportant: boolean,
): Promise<ActionState> {
  await requireUser();

  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc || doc.contractId !== contractId) {
    return { error: "Document not found." };
  }

  await prisma.document.update({ where: { id: documentId }, data: { isImportant } });

  revalidatePath(`/contracts/${contractId}`);
  return { success: isImportant ? "Marked as important." : "Unmarked as important." };
}

export async function setContractStatus(
  contractId: string,
  status: "ACTIVE" | "CANCELLED",
): Promise<ActionState> {
  await requireUser();

  const existing = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!existing) return { error: "Contract not found." };

  await prisma.contract.update({ where: { id: contractId }, data: { status } });

  revalidatePath(`/contracts/${contractId}`);
  revalidatePath("/contracts");
  revalidatePath("/dashboard");
  return { success: status === "CANCELLED" ? "Contract cancelled." : "Contract reactivated." };
}
