// Shared by contracts.ts and products.ts — reads the two form-only control
// fields ContractForm/ProductForm set when a document scan populated fields
// this session (#200): "extractionUsed" (did a scan happen at all) and
// "confirmExtraction" (did the user check "these look correct" before
// saving). Neither is part of the Zod schema — they're submission-time
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
  const confirmed = formData.get("confirmExtraction") === "1";
  return confirmed
    ? { extractionPending: false, extractionConfirmedAt: new Date() }
    : { extractionPending: true, extractionConfirmedAt: null };
}
