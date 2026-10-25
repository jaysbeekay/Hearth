"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { propertySchema, homeItemSchema, rentalAgreementSchema, rentalStatementSchema } from "@/lib/validation/home";
import { addDocumentCommand, removeOwnerDocumentFiles } from "@/lib/commands/documents";
import { formDataToStringValues } from "@/lib/form-state";
import { isModuleEnabled } from "@/lib/modules/enablement";
import type { ActionState } from "@/lib/actions/auth";
import { describeUploadRejection } from "@/lib/uploadValidation";
import { parseDocumentCategory } from "@/lib/documents/categories";

const PROPERTY_FORM_FIELDS = [
  "label",
  "street",
  "suburb",
  "state",
  "postcode",
  "country",
  "lat",
  "lng",
  "notes",
  "occupancyStatus",
];

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
  if (!(await isModuleEnabled("HOME"))) throw new Error("Property module is disabled");
  if (session.user.role === "READONLY") throw new Error("Your account has read-only access.");
  return session.user;
}

function formToPropertyInput(formData: FormData) {
  return {
    label: formData.get("label"),
    street: formData.get("street"),
    suburb: formData.get("suburb"),
    state: formData.get("state"),
    postcode: formData.get("postcode"),
    country: formData.get("country"),
    lat: formData.get("lat"),
    lng: formData.get("lng"),
    notes: formData.get("notes"),
    occupancyStatus: formData.get("occupancyStatus") || undefined,
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
  const user = await requireUser();

  const parsed = propertySchema.safeParse(formToPropertyInput(formData));
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, PROPERTY_FORM_FIELDS),
    };
  }

  const existing = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!existing) return { error: "Property not found." };

  await prisma.property.update({ where: { id: propertyId }, data: { ...parsed.data, updatedById: user.id } });

  revalidatePath("/home");
  revalidatePath(`/home/${propertyId}`);
  redirect(`/home/${propertyId}`);
}

// #287 — soft-delete: see the equivalent comment on deleteContract (contracts.ts).
export async function deleteProperty(propertyId: string): Promise<ActionState> {
  await requireUser();

  const existing = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!existing) return { error: "Property not found." };

  await prisma.property.update({ where: { id: propertyId }, data: { deletedAt: new Date() } });

  revalidatePath("/home");
  revalidatePath("/settings/trash");
  redirect("/home");
}

export async function restoreProperty(propertyId: string): Promise<ActionState> {
  await requireUser();

  const existing = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!existing) return { error: "Property not found." };

  await prisma.property.update({ where: { id: propertyId }, data: { deletedAt: null } });

  revalidatePath("/home");
  revalidatePath("/settings/trash");
  return { success: "Restored." };
}

export async function permanentlyDeleteProperty(propertyId: string): Promise<ActionState> {
  await requireUser();

  const existing = await prisma.property.findUnique({
    where: { id: propertyId },
    include: { items: { select: { id: true } }, rentalStatements: { select: { id: true } } },
  });
  if (!existing) return { error: "Property not found." };

  // Cascade removes the DB rows but not the uploaded files — clean those up first.
  for (const item of existing.items) {
    await removeOwnerDocumentFiles("HOME_ITEM", item.id);
  }
  for (const statement of existing.rentalStatements) {
    await removeOwnerDocumentFiles("RENTAL_STATEMENT", statement.id);
  }

  await prisma.property.delete({ where: { id: propertyId } });

  revalidatePath("/settings/trash");
  return { success: "Deleted permanently." };
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
    const rejection = await describeUploadRejection(file);
    if (rejection) return { error: rejection };
  }

  const item = await prisma.homeItem.create({
    data: { ...parsed.data, propertyId },
  });

  if (file instanceof File && file.size > 0) {
    await addDocumentCommand("HOME_ITEM", item.id, {
      file,
      category: parseDocumentCategory(formData.get("documentCategory")),
    });
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

  await prisma.homeItem.update({ where: { id: itemId }, data: { deletedAt: new Date() } });

  revalidatePath(`/home/${propertyId}`);
  revalidatePath("/settings/trash");
  return { success: "Item moved to Trash." };
}

export async function restoreHomeItem(itemId: string): Promise<ActionState> {
  await requireUser();

  const item = await prisma.homeItem.findUnique({ where: { id: itemId } });
  if (!item) return { error: "Item not found." };

  await prisma.homeItem.update({ where: { id: itemId }, data: { deletedAt: null } });
  revalidatePath(`/home/${item.propertyId}`);
  revalidatePath("/settings/trash");
  return { success: "Restored." };
}

export async function permanentlyDeleteHomeItem(itemId: string): Promise<ActionState> {
  await requireUser();

  const item = await prisma.homeItem.findUnique({ where: { id: itemId } });
  if (!item) return { error: "Item not found." };

  await removeOwnerDocumentFiles("HOME_ITEM", itemId);
  await prisma.homeItem.delete({ where: { id: itemId } });
  revalidatePath(`/home/${item.propertyId}`);
  revalidatePath("/settings/trash");
  return { success: "Deleted permanently." };
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

async function setRentalAgreementContract(
  propertyId: string,
  agreementId: string,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const existing = await prisma.rentalAgreement.findUnique({ where: { id: agreementId } });
  if (!existing || existing.propertyId !== propertyId) return { error: "Agreement not found." };

  const contractId = formData.get("contractId");
  let newContractId: string | null = null;
  if (typeof contractId === "string" && contractId.trim() !== "") {
    const contract = await prisma.contract.findUnique({ where: { id: contractId } });
    if (!contract) return { error: "Contract not found." };
    if (contract.category !== "RENTAL") {
      return { error: "Only Rental-category contracts can be linked." };
    }
    newContractId = contract.id;
  }

  await prisma.rentalAgreement.update({
    where: { id: agreementId },
    data: { contractId: newContractId },
  });

  revalidatePath(`/home/${propertyId}/rental`);
  revalidatePath("/contracts");
  if (existing.contractId) revalidatePath(`/contracts/${existing.contractId}`);
  if (newContractId) revalidatePath(`/contracts/${newContractId}`);
  return { success: newContractId ? "Contract linked." : "Contract unlinked." };
}

export async function linkRentalAgreementContract(
  propertyId: string,
  agreementId: string,
  formData: FormData,
): Promise<void> {
  await setRentalAgreementContract(propertyId, agreementId, formData);
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
    const rejection = await describeUploadRejection(file);
    if (rejection) return { error: rejection };
  }

  const statement = await prisma.rentalStatement.create({
    data: { ...parsed.data, propertyId },
  });

  if (file instanceof File && file.size > 0) {
    await addDocumentCommand("RENTAL_STATEMENT", statement.id, { file });
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
  await removeOwnerDocumentFiles("RENTAL_STATEMENT", statementId);

  revalidatePath(`/home/${propertyId}/rental`);
  return { success: "Statement removed." };
}

