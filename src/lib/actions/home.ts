"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { formToPropertyInput, formToHomeItemInput, formToRentalAgreementInput, formToRentalStatementInput } from "@/lib/formMappers";
import { fullFormUpdate } from "@/lib/validation/fullFormUpdate";
import { propertySchema, homeItemSchema, rentalAgreementSchema, rentalStatementSchema } from "@/lib/validation/home";
import { addDocumentCommand } from "@/lib/commands/documents";
import { formDataToStringValues } from "@/lib/form-state";
import { isModuleEnabled, ModuleDisabledError } from "@/lib/modules/enablement";
import {
  createPropertyCommand,
  updatePropertyCommand,
  setPropertyRentedCommand,
  deletePropertyCommand,
  restorePropertyCommand,
  archivePropertyCommand,
  unarchivePropertyCommand,
  permanentlyDeletePropertyCommand,
  createMaintenanceRecordCommand,
  updateMaintenanceRecordCommand,
  deleteMaintenanceRecordCommand,
  restoreMaintenanceRecordCommand,
  permanentlyDeleteMaintenanceRecordCommand,
  createTenancyCommand,
  updateTenancyCommand,
  linkTenancyContractCommand,
  deleteTenancyCommand,
  restoreTenancyCommand,
  permanentlyDeleteTenancyCommand,
  createRentalStatementCommand,
  updateRentalStatementCommand,
  deleteRentalStatementCommand,
  restoreRentalStatementCommand,
  permanentlyDeleteRentalStatementCommand,
  TenancyContractLinkError,
} from "@/lib/commands/home";
import { RecordNotFoundError, RecordValidationError, StaleEditError } from "@/lib/commands/shared";
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
  "reminderDaysBefore",
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

// Turns a command's not-found / stale-edit / module-disabled error into the
// ActionState the form shows; anything else is unexpected and rethrown.
function commandError(error: unknown, notFound: string): ActionState {
  if (error instanceof RecordNotFoundError) return { error: notFound };
  if (
    error instanceof StaleEditError ||
    error instanceof ModuleDisabledError ||
    error instanceof TenancyContractLinkError ||
    error instanceof RecordValidationError
  ) {
    return { error: error.message };
  }
  throw error;
}

function attachedFile(formData: FormData): File | null {
  const file = formData.get("file");
  return file instanceof File && file.size > 0 ? file : null;
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

  // requireUser() has already checked the module, and a create has no
  // record to be missing, so there's no command error to map here.
  const property = await createPropertyCommand(parsed.data, user.id);
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

  try {
    await updatePropertyCommand(propertyId, fullFormUpdate(propertySchema, parsed.data, formData), user.id);
  } catch (error) {
    return commandError(error, "Property not found.");
  }
  redirect(`/home/${propertyId}`);
}

// #287 — soft-delete: see the equivalent comment on deleteContract (contracts.ts).
export async function deleteProperty(propertyId: string): Promise<ActionState> {
  await requireUser();
  try {
    await deletePropertyCommand(propertyId);
  } catch (error) {
    return commandError(error, "Property not found.");
  }
  redirect("/home");
}

export async function restoreProperty(propertyId: string): Promise<ActionState> {
  await requireUser();
  try {
    await restorePropertyCommand(propertyId);
  } catch (error) {
    return commandError(error, "Property not found.");
  }
  return { success: "Restored." };
}

// #355 — Archive / unarchive: see archivePropertyCommand.
export async function archiveProperty(propertyId: string): Promise<ActionState> {
  const user = await requireUser();
  try {
    await archivePropertyCommand(propertyId, user.id);
  } catch (error) {
    return commandError(error, "Property not found.");
  }
  return { success: "Archived." };
}

export async function unarchiveProperty(propertyId: string): Promise<ActionState> {
  const user = await requireUser();
  try {
    await unarchivePropertyCommand(propertyId, user.id);
  } catch (error) {
    return commandError(error, "Property not found.");
  }
  return { success: "Restored." };
}

export async function permanentlyDeleteProperty(propertyId: string): Promise<ActionState> {
  await requireUser();
  try {
    await permanentlyDeletePropertyCommand(propertyId);
  } catch (error) {
    return commandError(error, "Property not found.");
  }
  return { success: "Deleted permanently." };
}

export async function addHomeItem(
  propertyId: string,
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

  const file = attachedFile(formData);
  if (file) {
    const rejection = await describeUploadRejection(file);
    if (rejection) return { error: rejection };
  }

  let itemId: string;
  try {
    itemId = (await createMaintenanceRecordCommand(propertyId, parsed.data)).id;
  } catch (error) {
    return commandError(error, "Property not found.");
  }

  if (file) {
    await addDocumentCommand("HOME_ITEM", itemId, {
      file,
      category: parseDocumentCategory(formData.get("documentCategory")),
    });
  }

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

  try {
    await updateMaintenanceRecordCommand(itemId, fullFormUpdate(homeItemSchema, parsed.data, formData), {
      propertyId,
    });
  } catch (error) {
    return commandError(error, "Maintenance record not found.");
  }
  redirect(`/home/${propertyId}`);
}

export async function deleteHomeItem(propertyId: string, itemId: string): Promise<ActionState> {
  await requireUser();
  try {
    await deleteMaintenanceRecordCommand(itemId, { propertyId });
  } catch (error) {
    return commandError(error, "Maintenance record not found.");
  }
  return { success: "Maintenance record moved to Trash." };
}

export async function restoreHomeItem(itemId: string): Promise<ActionState> {
  await requireUser();
  try {
    await restoreMaintenanceRecordCommand(itemId);
  } catch (error) {
    return commandError(error, "Maintenance record not found.");
  }
  return { success: "Restored." };
}

export async function permanentlyDeleteHomeItem(itemId: string): Promise<ActionState> {
  await requireUser();
  try {
    await permanentlyDeleteMaintenanceRecordCommand(itemId);
  } catch (error) {
    return commandError(error, "Maintenance record not found.");
  }
  return { success: "Deleted permanently." };
}

// ─── Rental agreement (Tenancy) ──────────────────────────────────────────────

export async function createRentalAgreement(
  propertyId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const parsed = rentalAgreementSchema.safeParse(formToRentalAgreementInput(formData));
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, RENTAL_AGREEMENT_FORM_FIELDS),
    };
  }

  try {
    await createTenancyCommand(propertyId, parsed.data, user.id);
  } catch (error) {
    return commandError(error, "Property not found.");
  }
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

  try {
    await updateTenancyCommand(agreementId, fullFormUpdate(rentalAgreementSchema, parsed.data, formData), {
      propertyId,
    });
  } catch (error) {
    return commandError(error, "Tenancy not found.");
  }
  redirect(`/home/${propertyId}/rental`);
}

export async function deleteRentalAgreement(
  propertyId: string,
  agreementId: string,
): Promise<ActionState> {
  await requireUser();
  try {
    await deleteTenancyCommand(agreementId, { propertyId });
  } catch (error) {
    return commandError(error, "Tenancy not found.");
  }
  return { success: "Tenancy moved to Trash." };
}

export async function restoreRentalAgreement(agreementId: string): Promise<ActionState> {
  await requireUser();
  try {
    await restoreTenancyCommand(agreementId);
  } catch (error) {
    return commandError(error, "Tenancy not found.");
  }
  return { success: "Restored." };
}

export async function permanentlyDeleteRentalAgreement(agreementId: string): Promise<ActionState> {
  await requireUser();
  try {
    await permanentlyDeleteTenancyCommand(agreementId);
  } catch (error) {
    return commandError(error, "Tenancy not found.");
  }
  return { success: "Deleted permanently." };
}

// Links (or, with a blank contractId, unlinks) a Tenancy's Contract and says
// how it went. The form posts to linkRentalAgreementContract below, which
// needs a void return.
export async function setRentalAgreementContract(
  propertyId: string,
  agreementId: string,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const contractId = formData.get("contractId");
  const newContractId = typeof contractId === "string" && contractId.trim() !== "" ? contractId : null;

  try {
    await linkTenancyContractCommand(agreementId, newContractId, { propertyId });
  } catch (error) {
    // A missing Contract is a TenancyContractLinkError with its own message;
    // a RecordNotFoundError here is the Tenancy itself.
    return commandError(error, "Tenancy not found.");
  }
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
  const user = await requireUser();
  try {
    await setPropertyRentedCommand(propertyId, isRented, user.id);
  } catch (error) {
    return commandError(error, "Property not found.");
  }
  return { success: isRented ? "Tracking a tenancy for this property." : "Stopped tracking tenancy." };
}

// ─── Rental statements ───────────────────────────────────────────────────────

export async function createRentalStatement(
  propertyId: string,
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

  const file = attachedFile(formData);
  if (file) {
    const rejection = await describeUploadRejection(file);
    if (rejection) return { error: rejection };
  }

  let statementId: string;
  try {
    statementId = (await createRentalStatementCommand(propertyId, parsed.data)).id;
  } catch (error) {
    return commandError(error, "Property not found.");
  }

  if (file) {
    await addDocumentCommand("RENTAL_STATEMENT", statementId, { file });
  }

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

  try {
    await updateRentalStatementCommand(
      statementId,
      fullFormUpdate(rentalStatementSchema, parsed.data, formData),
      { propertyId },
    );
  } catch (error) {
    return commandError(error, "Statement not found.");
  }
  redirect(`/home/${propertyId}/rental`);
}

export async function deleteRentalStatement(
  propertyId: string,
  statementId: string,
): Promise<ActionState> {
  await requireUser();
  try {
    await deleteRentalStatementCommand(statementId, { propertyId });
  } catch (error) {
    return commandError(error, "Statement not found.");
  }
  return { success: "Statement moved to Trash." };
}

export async function restoreRentalStatement(statementId: string): Promise<ActionState> {
  await requireUser();
  try {
    await restoreRentalStatementCommand(statementId);
  } catch (error) {
    return commandError(error, "Statement not found.");
  }
  return { success: "Restored." };
}

export async function permanentlyDeleteRentalStatement(statementId: string): Promise<ActionState> {
  await requireUser();
  try {
    await permanentlyDeleteRentalStatementCommand(statementId);
  } catch (error) {
    return commandError(error, "Statement not found.");
  }
  return { success: "Deleted permanently." };
}
