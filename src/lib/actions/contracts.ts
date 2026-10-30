"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  contractSchema,
  contractPatchSchema,
  contractRenewalSchema,
  CONTRACT_STATUSES,
} from "@/lib/validation/contract";
import { parseNamedPatch } from "@/lib/validation/namedPatch";
import { fullFormUpdate } from "@/lib/validation/fullFormUpdate";
import { formDataToStringValues } from "@/lib/form-state";
import { formToContractInput } from "@/lib/formMappers";
import { addDocumentCommand } from "@/lib/commands/documents";
import { describeUploadRejection, UploadRejectedError } from "@/lib/uploadValidation";
import { extractionFieldsFromForm } from "@/lib/documents/extractionConfirmation";
import {
  saveExtractionReviewFieldsFromForm,
  contractReviewCorrectionsFromForm,
} from "@/lib/documents/extractionReview";
import { saveFileToInboxFallback } from "@/lib/documents/inboxFallback";
import { parseDocumentCategory } from "@/lib/documents/categories";
import {
  createContractCommand,
  updateContractCommand,
  renewContractCommand,
  confirmContractExtractionCommand,
  deleteContractCommand,
  restoreContractCommand,
  permanentlyDeleteContractCommand,
} from "@/lib/commands/contracts";
import { RecordNotFoundError, RecordValidationError, StaleEditError } from "@/lib/commands/shared";
import { linkedRecordError } from "@/lib/commands/links";

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

// Turns a command's not-found / stale-edit error into the ActionState the
// caller shows; anything else is unexpected and rethrown.
function commandError(error: unknown): { error: string } {
  if (error instanceof RecordNotFoundError) return { error: "Contract not found." };
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
    console.error("[assistant] contract write failed:", unexpected);
    return { success: false, error: "Couldn't save that change." };
  }
}

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in");
  if (session.user.role === "READONLY") throw new Error("Your account has read-only access.");
  return session.user;
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
    try {
      await addDocumentCommand("CONTRACT", contract.id, {
        file,
        category: parseDocumentCategory(formData.get("documentCategory")),
      });
    } catch (error) {
      if (!(error instanceof UploadRejectedError)) throw error;
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
      { ...fullFormUpdate(contractSchema, parsed.data, formData), ...extractionFieldsFromForm(formData) },
      user.id,
    );
    await saveExtractionReviewFieldsFromForm("CONTRACT", contractId, formData);
  } catch (error) {
    return commandError(error);
  }
  redirect(`/contracts/${contractId}`);
}

const RENEWAL_FORM_FIELDS = ["startDate", "endDate", "cost", "termDocumentId"];

// The Renew form's "Paperwork for the term being kept" select: left out
// when there was nothing to choose between (the command picks), "" for None.
function termDocumentFromForm(formData: FormData): string | null | undefined {
  const value = formData.get("termDocumentId");
  if (typeof value !== "string") return undefined;
  return value === "" ? null : value;
}

/**
 * #353 — the Renew form: adds the Contract's next Term, keeping the current
 * one as history, then attaches the new Term's Document if one was chosen.
 * The form carries the updatedAt it was loaded with, so a second submit (or
 * a renewal someone else saved meanwhile) is refused rather than adding a
 * second Term.
 */
export async function renewContract(
  contractId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const values = () => formDataToStringValues(formData, RENEWAL_FORM_FIELDS);

  const parsed = contractRenewalSchema.safeParse({
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    cost: formData.get("cost"),
  });
  if (!parsed.success) return { error: firstIssueMessage(parsed.error), values: values() };

  const file = formData.get("file");
  const hasFile = file instanceof File && file.size > 0;
  if (hasFile) {
    const rejection = await describeUploadRejection(file);
    if (rejection) return { error: rejection, values: values() };
  }

  const baseUpdatedAt = formData.get("baseUpdatedAt");
  try {
    await renewContractCommand(
      contractId,
      { ...parsed.data, termDocumentId: termDocumentFromForm(formData) },
      user.id,
      { baseUpdatedAt: typeof baseUpdatedAt === "string" && baseUpdatedAt ? baseUpdatedAt : undefined },
    );
  } catch (error) {
    return { ...commandError(error), values: values() };
  }

  // The renewal is saved by now, so nothing below may turn into an error
  // page: a Document that can't be attached goes to the Inbox instead, and
  // if even that fails the Contract page says so.
  let docFallback: "inbox" | "failed" | null = null;
  if (hasFile) {
    try {
      await addDocumentCommand("CONTRACT", contractId, {
        file,
        // The new Term's paperwork, unless the form says otherwise.
        category: parseDocumentCategory(formData.get("documentCategory")) ?? "POLICY",
      });
    } catch (error) {
      console.error("[renew] couldn't attach the new term's document:", error);
      const fallback = await saveFileToInboxFallback(file, user.id).catch(() => null);
      docFallback = fallback ? "inbox" : "failed";
    }
  }

  redirect(`/contracts/${contractId}${docFallback ? `?docFallback=${docFallback}` : ""}`);
}

/**
 * Standalone confirm action for the detail page's DetailStatusBanner —
 * clears extractionPending without reopening the edit form, for the case
 * where a user reviews the already-saved values in place (#200).
 */
export async function confirmContractExtraction(contractId: string): Promise<ActionState> {
  const user = await requireUser();

  try {
    await confirmContractExtractionCommand(contractId, {}, user.id);
  } catch (error) {
    return commandError(error);
  }
  return { success: "Details confirmed." };
}

/**
 * Field-level review counterpart to confirmContractExtraction (#331) — takes
 * the review panel's (possibly corrected) field values instead of
 * confirming the extracted values as-is.
 */
export async function reviewContractExtraction(
  contractId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  try {
    await confirmContractExtractionCommand(contractId, contractReviewCorrectionsFromForm(formData), user.id);
  } catch (error) {
    return commandError(error);
  }
  return { success: "Details confirmed." };
}

export type AssistantActionResult =
  | { success: true; contractId: string }
  | { success: false; error: string };

// Counterparts to createContract/updateContract for the AI Assistant's
// guarded-write flow (see src/lib/chat/tools.ts) — same requireUser() gate
// and contract schema as the real forms, but returns a plain result instead
// of redirect()ing, since a chat reply shouldn't navigate the user away from
// their conversation. A create takes a full record (contractSchema, with its
// defaults); an update takes only the fields the Assistant named
// (contractPatchSchema), as a partial patch.
export async function createContractFromAssistant(
  data: Record<string, unknown>,
): Promise<AssistantActionResult> {
  const user = await requireUser();

  const parsed = contractSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: firstIssueMessage(parsed.error) };

  const linkError = await linkedRecordError(parsed.data);
  if (linkError) return { success: false, error: linkError };

  try {
    const contract = await createContractCommand(parsed.data, user.id);
    return { success: true, contractId: contract.id };
  } catch (error) {
    return assistantFailure(error);
  }
}

export async function updateContractFromAssistant(
  contractId: string,
  data: Record<string, unknown>,
): Promise<AssistantActionResult> {
  const user = await requireUser();

  // Only the fields the Assistant named are written (#420); the rest of the
  // record stays as it is. `data` comes back from the client, so it's
  // re-parsed here: unknown keys are stripped, but any valid field of the
  // record is accepted even if the proposal didn't name it, since it's one
  // the user could set themselves. Binding the write to exactly the fields
  // the card showed would need a signed or stored proposal.
  const parsed = parseNamedPatch(contractPatchSchema, data);
  if (!parsed.success) return parsed;

  const linkError = await linkedRecordError(parsed.data);
  if (linkError) return { success: false, error: linkError };

  try {
    await updateContractCommand(contractId, parsed.data, user.id);
  } catch (error) {
    return assistantFailure(error);
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
    return commandError(error);
  }
  redirect("/contracts");
}

export async function restoreContract(contractId: string): Promise<ActionState> {
  await requireUser();

  try {
    await restoreContractCommand(contractId);
  } catch (error) {
    return commandError(error);
  }
  return { success: "Restored." };
}

export async function permanentlyDeleteContract(contractId: string): Promise<ActionState> {
  await requireUser();

  try {
    await permanentlyDeleteContractCommand(contractId);
  } catch (error) {
    return commandError(error);
  }
  return { success: "Deleted permanently." };
}

export async function setContractStatus(
  contractId: string,
  status: "ACTIVE" | "CANCELLED",
): Promise<ActionState> {
  const user = await requireUser();
  // A bound server action's arguments can still be tampered with.
  if (!CONTRACT_STATUSES.includes(status)) return { error: "Invalid status." };

  // A partial patch: only the status changes, and the command revalidates
  // the same paths as any other update.
  try {
    await updateContractCommand(contractId, { status }, user.id);
  } catch (error) {
    return commandError(error);
  }
  return { success: status === "CANCELLED" ? "Contract cancelled." : "Contract reactivated." };
}
