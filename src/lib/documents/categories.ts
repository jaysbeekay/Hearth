export const DOCUMENT_CATEGORIES = [
  "POLICY",
  "INVOICE",
  "RECEIPT",
  "WARRANTY_CARD",
  "MANUAL",
  "RENTAL_AGREEMENT",
  "SERVICE_RECORD",
  "PHOTO",
  "OTHER",
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  POLICY: "Policy",
  INVOICE: "Invoice",
  RECEIPT: "Receipt",
  WARRANTY_CARD: "Warranty card",
  MANUAL: "Manual",
  RENTAL_AGREEMENT: "Rental agreement",
  SERVICE_RECORD: "Service record",
  PHOTO: "Photo",
  OTHER: "Other",
};

export function parseDocumentCategory(value: FormDataEntryValue | null): DocumentCategory | null {
  return typeof value === "string" && DOCUMENT_CATEGORIES.includes(value as DocumentCategory)
    ? (value as DocumentCategory)
    : null;
}
