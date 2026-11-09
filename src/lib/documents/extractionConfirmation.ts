// Shared by contracts.ts and products.ts — reads the two form-only control
// fields ContractForm/ProductForm set when a document scan populated fields
// this session (#200): "extractionUsed" (did a scan happen at all) and
// "confirmExtraction" (did the person review it: since #359, pressing Save
// on the form is the review, and "Save for later review" opts out). Neither is part of the Zod schema — they're submission-time
// control signals, not persisted record data by themselves, read directly
// off FormData the same way the "file" upload fields already are.
//
// No entry in the returned object at all (rather than `undefined` values)
// when no scan happened this submission, so a Prisma `data: { ...parsed.data,
// ...extractionFieldsFromForm(formData) }` spread never touches these
// columns on a plain manual edit — an existing "needs review" flag is left
// exactly as it was until the user acts on it.
export function extractionFieldsFromForm(formData: FormData): {
  extractionPending?: boolean;
  extractionConfirmedAt?: Date | null;
} {
  if (formData.get("extractionUsed") !== "1") return {};
  // #359 — the forms send "1" from a hidden field and "0" from the "Save for
  // later review" button that submitted, so any "0" means not confirmed.
  const values = formData.getAll("confirmExtraction");
  const confirmed = values.includes("1") && !values.includes("0");
  return confirmed
    ? { extractionPending: false, extractionConfirmedAt: new Date() }
    : { extractionPending: true, extractionConfirmedAt: null };
}

/**
 * The names of the auto-filled fields a form submitted as provenance
 * ("extractionReviewFields"), for the Security log entry when the save
 * confirmed them. Empty when the form didn't send any.
 */
export function autoFilledFieldNamesFromForm(formData: FormData): string[] {
  const raw = formData.get("extractionReviewFields");
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .slice(0, 100)
      .map((field: unknown) =>
        field != null && typeof field === "object" && "fieldName" in field && typeof field.fieldName === "string"
          ? field.fieldName.trim().slice(0, 100)
          : "",
      )
      .filter((name) => name.length > 0);
  } catch {
    return [];
  }
}

// Mirrors fieldExtraction.ts's LOW_CONFIDENCE_THRESHOLD: a scan that found
// fewer fields than this is a weak read of the document.
const LOW_CONFIDENCE_FIELD_COUNT = 2;

/**
 * #359 — whether a row saved from Upload or the Inbox counts as reviewed:
 * the person changed something on it, or the scan read it confidently
 * enough (a text or AI scan that filled at least LOW_CONFIDENCE_FIELD_COUNT
 * fields). Only an untouched, weakly-read row is left as Needs review.
 * Email-ingested documents never come through here: nobody looked at them.
 */
export function extractionReviewedOnSave({
  edited,
  source,
  autoFilledCount,
}: {
  edited: boolean;
  source: "byok" | "heuristic" | "llm" | "none";
  autoFilledCount: number;
}): boolean {
  if (edited) return true;
  return source !== "none" && autoFilledCount >= LOW_CONFIDENCE_FIELD_COUNT;
}
