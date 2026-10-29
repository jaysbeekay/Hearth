import { documentCategoryLabel } from "@/lib/documents/categories";

// Client-safe shaping for the one Document list (#397). Every Document
// table has these columns, so the list takes any kind's rows as they are.

/** The columns the Document list reads, common to every Document table. */
export interface DocumentListRow {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  uploadedAt: Date;
  category: string | null;
  isImportant: boolean;
  supersedesId: string | null;
}

/** A Document as the list shows it: its latest version, and its older versions newest first. */
export interface DocumentVersionGroup<T extends DocumentListRow> {
  latest: T;
  older: T[];
}

/**
 * Groups Documents into version chains through supersedesId (#206). The
 * latest version is any Document that nothing else in the list supersedes;
 * walking back from it gives the older ones. Only the rows passed in count,
 * so an older version in Trash ends the chain there, and a Document whose
 * newer version is in Trash shows as the latest.
 */
export function groupDocumentVersions<T extends DocumentListRow>(documents: T[]): DocumentVersionGroup<T>[] {
  const byId = new Map(documents.map((d) => [d.id, d]));
  const superseded = new Set<string>();
  for (const d of documents) {
    if (d.supersedesId) superseded.add(d.supersedesId);
  }
  return documents
    .filter((d) => !superseded.has(d.id))
    .map((latest) => {
      const older: T[] = [];
      const seen = new Set([latest.id]);
      let cursor = latest.supersedesId;
      while (cursor && !seen.has(cursor)) {
        const doc = byId.get(cursor);
        if (!doc) break;
        older.push(doc);
        seen.add(cursor);
        cursor = doc.supersedesId;
      }
      return { latest, older };
    });
}

// Before #350 a Warranty Document had only its legacy kind and no Document
// type, so the kind stands in for one.
const PRODUCT_KIND_LABELS = new Map([
  ["INVOICE", "Invoice"],
  ["PHOTO", "Photo"],
  ["MANUAL", "Manual"],
  ["OTHER", "Other"],
]);

/** The Document type pill's text, or null for no pill. */
export function documentTypeLabel(doc: { category: string | null }, productKind?: string | null): string | null {
  const label = documentCategoryLabel(doc.category);
  if (label) return label;
  return productKind ? (PRODUCT_KIND_LABELS.get(productKind) ?? null) : null;
}

/** Whether the row shows a thumbnail of the image instead of a file icon. */
export function showsThumbnail(doc: { category: string | null; mimeType: string }, productKind?: string | null): boolean {
  if (!doc.mimeType.startsWith("image/")) return false;
  return doc.category === "PHOTO" || (!doc.category && productKind === "PHOTO");
}
