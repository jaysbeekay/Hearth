import { prisma } from "@/lib/prisma";
import { logSecurityEvent } from "@/lib/securityEventLog";
import { autoFilledFieldNamesFromForm, extractionFieldsFromForm } from "@/lib/documents/extractionConfirmation";
import type { ExtractionReviewOwnerType } from "@/lib/documents/extractionReview";

// The record page used to say "Auto-filled details confirmed {date}" to
// everyone in the household. That's audit detail, so it's now an admin-only
// entry in Settings > Security log instead: who confirmed which record's
// auto-filled details, when, and which fields the scan had filled.

const KIND_LABEL: Record<ExtractionReviewOwnerType, string> = { CONTRACT: "Contract", PRODUCT: "Warranty" };

/** "warrantyEndDate" -> "Warranty end date". */
export function fieldLabel(fieldName: string): string {
  const words = fieldName.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The Security log line for a confirmation, e.g. `Contract "Netflix" · auto-filled: Title, Cost`. */
export function extractionConfirmedDetail(
  ownerType: ExtractionReviewOwnerType,
  title: string,
  fieldNames: readonly string[],
): string {
  const unique = [...new Set(fieldNames)];
  const fields = unique.length > 0 ? ` · auto-filled: ${unique.map(fieldLabel).join(", ")}` : "";
  return `${KIND_LABEL[ownerType]} "${title}"${fields}`;
}

/**
 * Records that `actorId` confirmed a record's auto-filled details. Call it
 * after the confirming write has landed. Never throws: the confirmation has
 * already been saved, and a missing audit entry mustn't turn it into an error.
 */
export async function logExtractionConfirmed(params: {
  ownerType: ExtractionReviewOwnerType;
  ownerId: string;
  actorId: string;
  fieldNames: readonly string[];
}): Promise<void> {
  try {
    const [record, actor] = await Promise.all([
      params.ownerType === "CONTRACT"
        ? prisma.contract.findUnique({ where: { id: params.ownerId }, select: { title: true } })
        : prisma.product
            .findUnique({ where: { id: params.ownerId }, select: { description: true } })
            .then((product) => product && { title: product.description }),
      prisma.user.findUnique({ where: { id: params.actorId }, select: { email: true } }),
    ]);
    if (!record) return;
    await logSecurityEvent({
      type: "AUTOFILL_CONFIRMED",
      userId: params.actorId,
      email: actor?.email,
      detail: extractionConfirmedDetail(params.ownerType, record.title, params.fieldNames),
    });
  } catch (error) {
    console.error("[audit] failed to record an auto-fill confirmation:", error);
  }
}

/**
 * For a create or edit form save: logs the confirmation only when the save
 * confirmed a scan (#359, pressing Save after a scan is the review), with the
 * fields the form said the scan filled.
 */
export async function logExtractionConfirmedFromForm(
  ownerType: ExtractionReviewOwnerType,
  ownerId: string,
  actorId: string,
  formData: FormData,
): Promise<void> {
  if (!extractionFieldsFromForm(formData).extractionConfirmedAt) return;
  await logExtractionConfirmed({ ownerType, ownerId, actorId, fieldNames: autoFilledFieldNamesFromForm(formData) });
}
