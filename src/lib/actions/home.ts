"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { propertySchema, homeItemSchema, rentalAgreementSchema, rentalStatementSchema } from "@/lib/validation/home";
import {
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  deleteHomeItemDir,
  deleteHomeItemDocument as deleteHomeItemDocumentFile,
  saveHomeItemDocument,
  saveRentalStatementDocument,
  deleteRentalStatementDocument as deleteRentalStatementDocumentFile,
  deleteRentalStatementDir,
} from "@/lib/storage";
import { formDataToStringValues } from "@/lib/form-state";
import { isModuleEnabled } from "@/lib/modules/enablement";
import type { ActionState } from "@/lib/actions/auth";

const PROPERTY_FORM_FIELDS = ["label", "address", "notes"];

const RENTAL_AGREEMENT_FORM_FIELDS = [
  "tenantName",
  "weeklyRent",
  "managementFeePercent",
  "leaseStart",
  "leaseEnd",
  "bondAmount",
  "currency",
  "notes",
];

const RENTAL_STATEMENT_FORM_FIELDS = [
  "periodStart",
  "periodEnd",
  "statementDate",
  "grossRent",
  "managementFee",
  "otherDeductions",
  "netAmount",
  "currency",
  "notes",
];

const HOME_ITEM_FORM_FIELDS = [
  "type",
  "title",
  "provider",
  "date",
  "cost",
  "currency",
  "isTaxDeductible",
  "notes",
];

function firstIssueMessage(error: { issues: { message: string }[] }) {
  return error.issues[0]?.message ?? "Invalid input";
}

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in");
  if (!(await isModuleEnabled("HOME"))) throw new Error("Home module is disabled");
  if (session.user.role === "READONLY") throw new Error("Your account has read-only access.");
  return session.user;
}

async function attachItemDocument(homeItemId: string, file: File): Promise<ActionState | null> {
  if (file.size > MAX_UPLOAD_BYTES) return { error: "File is too large (15MB max)." };
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return { error: "Unsupported file type. Use PDF, Word, or image files." };
  }

  const { storedName, size } = await saveHomeItemDocument(homeItemId, file);
  await prisma.homeItemDocument.create({
    data: {
      homeItemId,
      filename: file.name.slice(0, 255),
      storedName,
      mimeType: file.type,
      size,
    },
  });
  return null;
}

function formToPropertyInput(formData: FormData) {
  return {
    label: formData.get("label"),
    address: formData.get("address"),
    notes: formData.get("notes"),
  };
}

function formToHomeItemInput(formData: FormData) {
  return {
    type: formData.get("type"),
    title: formData.get("title"),
    provider: formData.get("provider"),
    date: formData.get("date"),
    cost: formData.get("cost"),
    currency: formData.get("currency") || "AUD",
    isTaxDeductible: formData.get("isTaxDeductible") === "on",
    notes: formData.get("notes"),
  };
}

export async function createProperty(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const parsed = propertySchema.safeParse(formToPropertyInput(formData));
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, PROPERTY_FORM_FIELDS),
    };
  }

  const property = await prisma.property.create({
    data: { ...parsed.data, createdById: user.id },
  });

  revalidatePath("/home");
  redirect(`/home/${property.id}`);
}

export async function updateProperty(
  propertyId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const parsed = propertySchema.safeParse(formToPropertyInput(formData));
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, PROPERTY_FORM_FIELDS),
    };
  }

  const existing = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!existing) return { error: "Property not found." };

  await prisma.property.update({ where: { id: propertyId }, data: parsed.data });

  revalidatePath("/home");
  revalidatePath(`/home/${propertyId}`);
  redirect(`/home/${propertyId}`);
}

export async function deleteProperty(propertyId: string): Promise<ActionState> {
  await requireUser();

  const existing = await prisma.property.findUnique({
    where: { id: propertyId },
    include: { items: { select: { id: true } } },
  });
  if (!existing) return { error: "Property not found." };

  // Cascade removes the DB rows but not the uploaded files — clean those up first.
  for (const item of existing.items) {
    await deleteHomeItemDir(item.id);
  }

  await prisma.property.delete({ where: { id: propertyId } });

  revalidatePath("/home");
  redirect("/home");
}

export async function addHomeItem(
  propertyId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) return { error: "Property not found." };

  const parsed = homeItemSchema.safeParse(formToHomeItemInput(formData));
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, HOME_ITEM_FORM_FIELDS),
    };
  }

  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_UPLOAD_BYTES) return { error: "File is too large (15MB max)." };
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return { error: "Unsupported file type. Use PDF, Word, or image files." };
    }
  }

  const item = await prisma.homeItem.create({
    data: { ...parsed.data, propertyId },
  });

  if (file instanceof File && file.size > 0) {
    await attachItemDocument(item.id, file);
  }

  revalidatePath(`/home/${propertyId}`);
  redirect(`/home/${propertyId}`);
}

export async function updateHomeItem(
  propertyId: string,
  itemId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const parsed = homeItemSchema.safeParse(formToHomeItemInput(formData));
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, HOME_ITEM_FORM_FIELDS),
    };
  }

  const existing = await prisma.homeItem.findUnique({ where: { id: itemId } });
  if (!existing || existing.propertyId !== propertyId) return { error: "Item not found." };

  await prisma.homeItem.update({ where: { id: itemId }, data: parsed.data });

  revalidatePath(`/home/${propertyId}`);
  redirect(`/home/${propertyId}`);
}

export async function deleteHomeItem(propertyId: string, itemId: string): Promise<ActionState> {
  await requireUser();

  const existing = await prisma.homeItem.findUnique({ where: { id: itemId } });
  if (!existing || existing.propertyId !== propertyId) return { error: "Item not found." };

  await prisma.homeItem.delete({ where: { id: itemId } });
  await deleteHomeItemDir(itemId);

  revalidatePath(`/home/${propertyId}`);
  return { success: "Item removed." };
}

export async function addItemDocument(
  itemId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }

  const item = await prisma.homeItem.findUnique({ where: { id: itemId } });
  if (!item) return { error: "Item not found." };

  const error = await attachItemDocument(itemId, file);
  if (error) return error;

  revalidatePath(`/home/${item.propertyId}`);
  return { success: "Document uploaded." };
}

export async function deleteItemDocumentAction(
  itemId: string,
  documentId: string,
): Promise<ActionState> {
  await requireUser();

  const doc = await prisma.homeItemDocument.findUnique({ where: { id: documentId } });
  if (!doc || doc.homeItemId !== itemId) {
    return { error: "Document not found." };
  }

  const item = await prisma.homeItem.findUnique({ where: { id: itemId } });

  await prisma.homeItemDocument.delete({ where: { id: documentId } });
  await deleteHomeItemDocumentFile(itemId, doc.storedName);

  if (item) revalidatePath(`/home/${item.propertyId}`);
  return { success: "Document removed." };
}

// ─── Rental agreement ────────────────────────────────────────────────────────

function formToRentalAgreementInput(formData: FormData) {
  return {
    tenantName: formData.get("tenantName"),
    weeklyRent: formData.get("weeklyRent"),
    managementFeePercent: formData.get("managementFeePercent"),
    leaseStart: formData.get("leaseStart"),
    leaseEnd: formData.get("leaseEnd"),
    bondAmount: formData.get("bondAmount"),
    currency: formData.get("currency") || "AUD",
    notes: formData.get("notes"),
  };
}

export async function createRentalAgreement(
  propertyId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const parsed = rentalAgreementSchema.safeParse(formToRentalAgreementInput(formData));
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, RENTAL_AGREEMENT_FORM_FIELDS),
    };
  }

  const existing = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!existing) return { error: "Property not found." };

  await prisma.$transaction([
    prisma.rentalAgreement.create({ data: { ...parsed.data, propertyId } }),
    prisma.property.update({ where: { id: propertyId }, data: { isRented: true } }),
  ]);

  revalidatePath(`/home/${propertyId}`);
  revalidatePath(`/home/${propertyId}/rental`);
  redirect(`/home/${propertyId}/rental`);
}

export async function updateRentalAgreement(
  propertyId: string,
  agreementId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const parsed = rentalAgreementSchema.safeParse(formToRentalAgreementInput(formData));
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, RENTAL_AGREEMENT_FORM_FIELDS),
    };
  }

  const existing = await prisma.rentalAgreement.findUnique({ where: { id: agreementId } });
  if (!existing || existing.propertyId !== propertyId) return { error: "Agreement not found." };

  await prisma.rentalAgreement.update({ where: { id: agreementId }, data: parsed.data });

  revalidatePath(`/home/${propertyId}`);
  revalidatePath(`/home/${propertyId}/rental`);
  redirect(`/home/${propertyId}/rental`);
}

export async function deleteRentalAgreement(
  propertyId: string,
  agreementId: string,
): Promise<ActionState> {
  await requireUser();

  const existing = await prisma.rentalAgreement.findUnique({ where: { id: agreementId } });
  if (!existing || existing.propertyId !== propertyId) return { error: "Agreement not found." };

  await prisma.rentalAgreement.delete({ where: { id: agreementId } });

  revalidatePath(`/home/${propertyId}`);
  revalidatePath(`/home/${propertyId}/rental`);
  return { success: "Agreement removed." };
}

export async function setPropertyRented(
  propertyId: string,
  isRented: boolean,
): Promise<ActionState> {
  await requireUser();

  const existing = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!existing) return { error: "Property not found." };

  await prisma.property.update({ where: { id: propertyId }, data: { isRented } });

  revalidatePath(`/home/${propertyId}`);
  revalidatePath(`/home/${propertyId}/rental`);
  return { success: isRented ? "Rental tracking enabled." : "Rental tracking disabled." };
}

// ─── Rental statements ───────────────────────────────────────────────────────

function formToRentalStatementInput(formData: FormData) {
  return {
    periodStart: formData.get("periodStart"),
    periodEnd: formData.get("periodEnd"),
    statementDate: formData.get("statementDate"),
    grossRent: formData.get("grossRent"),
    managementFee: formData.get("managementFee"),
    otherDeductions: formData.get("otherDeductions"),
    netAmount: formData.get("netAmount"),
    currency: formData.get("currency") || "AUD",
    notes: formData.get("notes"),
  };
}

async function attachStatementDocument(
  statementId: string,
  file: File,
): Promise<ActionState | null> {
  if (file.size > MAX_UPLOAD_BYTES) return { error: "File is too large (15MB max)." };
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return { error: "Unsupported file type. Use PDF, Word, or image files." };
  }

  const { storedName, size } = await saveRentalStatementDocument(statementId, file);
  await prisma.rentalStatementDocument.create({
    data: {
      rentalStatementId: statementId,
      filename: file.name.slice(0, 255),
      storedName,
      mimeType: file.type,
      size,
    },
  });
  return null;
}

export async function createRentalStatement(
  propertyId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) return { error: "Property not found." };

  const parsed = rentalStatementSchema.safeParse(formToRentalStatementInput(formData));
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, RENTAL_STATEMENT_FORM_FIELDS),
    };
  }

  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_UPLOAD_BYTES) return { error: "File is too large (15MB max)." };
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return { error: "Unsupported file type. Use PDF, Word, or image files." };
    }
  }

  const statement = await prisma.rentalStatement.create({
    data: { ...parsed.data, propertyId },
  });

  if (file instanceof File && file.size > 0) {
    await attachStatementDocument(statement.id, file);
  }

  revalidatePath(`/home/${propertyId}/rental`);
  redirect(`/home/${propertyId}/rental`);
}

export async function updateRentalStatement(
  propertyId: string,
  statementId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const parsed = rentalStatementSchema.safeParse(formToRentalStatementInput(formData));
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, RENTAL_STATEMENT_FORM_FIELDS),
    };
  }

  const existing = await prisma.rentalStatement.findUnique({ where: { id: statementId } });
  if (!existing || existing.propertyId !== propertyId) return { error: "Statement not found." };

  await prisma.rentalStatement.update({ where: { id: statementId }, data: parsed.data });

  revalidatePath(`/home/${propertyId}/rental`);
  redirect(`/home/${propertyId}/rental`);
}

export async function deleteRentalStatement(
  propertyId: string,
  statementId: string,
): Promise<ActionState> {
  await requireUser();

  const existing = await prisma.rentalStatement.findUnique({ where: { id: statementId } });
  if (!existing || existing.propertyId !== propertyId) return { error: "Statement not found." };

  await prisma.rentalStatement.delete({ where: { id: statementId } });
  await deleteRentalStatementDir(statementId);

  revalidatePath(`/home/${propertyId}/rental`);
  return { success: "Statement removed." };
}

export async function addRentalStatementDocument(
  statementId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }

  const statement = await prisma.rentalStatement.findUnique({ where: { id: statementId } });
  if (!statement) return { error: "Statement not found." };

  const error = await attachStatementDocument(statementId, file);
  if (error) return error;

  revalidatePath(`/home/${statement.propertyId}/rental`);
  return { success: "Document uploaded." };
}

export async function deleteRentalStatementDocumentAction(
  statementId: string,
  documentId: string,
): Promise<ActionState> {
  await requireUser();

  const doc = await prisma.rentalStatementDocument.findUnique({ where: { id: documentId } });
  if (!doc || doc.rentalStatementId !== statementId) {
    return { error: "Document not found." };
  }

  const statement = await prisma.rentalStatement.findUnique({ where: { id: statementId } });

  await prisma.rentalStatementDocument.delete({ where: { id: documentId } });
  await deleteRentalStatementDocumentFile(statementId, doc.storedName);

  if (statement) revalidatePath(`/home/${statement.propertyId}/rental`);
  return { success: "Document removed." };
}
