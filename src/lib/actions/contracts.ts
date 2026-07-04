"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { contractSchema } from "@/lib/validation/contract";
import {
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  deleteContractDir,
  deleteDocument as deleteDocumentFile,
  saveDocument,
} from "@/lib/storage";
import { formDataToStringValues } from "@/lib/form-state";

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
];

function firstIssueMessage(error: { issues: { message: string }[] }) {
  return error.issues[0]?.message ?? "Invalid input";
}

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in");
  return session.user;
}

async function attachDocument(contractId: string, file: File): Promise<ActionState | null> {
  if (file.size > MAX_UPLOAD_BYTES) return { error: "File is too large (15MB max)." };
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return { error: "Unsupported file type. Use PDF, Word, or image files." };
  }

  const { storedName, size } = await saveDocument(contractId, file);
  await prisma.document.create({
    data: {
      contractId,
      filename: file.name.slice(0, 255),
      storedName,
      mimeType: file.type,
      size,
    },
  });
  return null;
}

function formToContractInput(formData: FormData) {
  return {
    title: formData.get("title"),
    category: formData.get("category"),
    provider: formData.get("provider"),
    contractNumber: formData.get("contractNumber"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    renewalType: formData.get("renewalType"),
    noticePeriodDays: formData.get("noticePeriodDays"),
    cost: formData.get("cost"),
    currency: formData.get("currency") || "AUD",
    billingFrequency: formData.get("billingFrequency"),
    status: formData.get("status") || "ACTIVE",
    contactName: formData.get("contactName"),
    contactPhone: formData.get("contactPhone"),
    contactEmail: formData.get("contactEmail"),
    notes: formData.get("notes"),
    reminderDaysBefore: formData.get("reminderDaysBefore"),
    isTaxDeductible: formData.get("isTaxDeductible") === "on",
  };
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
    if (file.size > MAX_UPLOAD_BYTES) return { error: "File is too large (15MB max)." };
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return { error: "Unsupported file type. Use PDF, Word, or image files." };
    }
  }

  const contract = await prisma.contract.create({
    data: { ...parsed.data, createdById: user.id },
  });

  if (file instanceof File && file.size > 0) {
    await attachDocument(contract.id, file);
  }

  revalidatePath("/contracts");
  revalidatePath("/dashboard");
  redirect(`/contracts/${contract.id}`);
}

export async function updateContract(
  contractId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const parsed = contractSchema.safeParse(formToContractInput(formData));
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, CONTRACT_FORM_FIELDS),
    };
  }

  const existing = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!existing) return { error: "Contract not found." };

  const endDateChanged =
    existing.endDate?.getTime() !== parsed.data.endDate?.getTime();

  await prisma.$transaction([
    prisma.contract.update({
      where: { id: contractId },
      data: parsed.data,
    }),
    ...(endDateChanged
      ? [prisma.notificationLog.deleteMany({ where: { contractId } })]
      : []),
  ]);

  revalidatePath("/contracts");
  revalidatePath(`/contracts/${contractId}`);
  revalidatePath("/dashboard");
  redirect(`/contracts/${contractId}`);
}

export async function deleteContract(contractId: string): Promise<ActionState> {
  await requireUser();

  const existing = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!existing) return { error: "Contract not found." };

  await prisma.contract.delete({ where: { id: contractId } });
  await deleteContractDir(contractId);

  revalidatePath("/contracts");
  revalidatePath("/dashboard");
  redirect("/contracts");
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

  const error = await attachDocument(contractId, file);
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

  await prisma.document.delete({ where: { id: documentId } });
  await deleteDocumentFile(contractId, doc.storedName);

  revalidatePath(`/contracts/${contractId}`);
  return { success: "Document removed." };
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
