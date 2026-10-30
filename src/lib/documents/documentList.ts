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

/** One version link of a Document that isn't listed (it's in Trash). */
export interface DocumentVersionLink {
  id: string;
  supersedesId: string | null;
}

/** A Document as the list shows it: its latest version, and its older versions newest first. */
export interface DocumentVersionGroup<T extends DocumentListRow> {
  latest: T;
  older: T[];
}

/**
 * Groups Documents into version chains through supersedesId (#206).
 *
 * `trashedLinks` are the version links of the same owner's Documents in
 * Trash. They aren't shown, but the chain is followed through them, so
 * putting one version in Trash doesn't split a Document in two: with
 * v1 ← v2 ← v3 and v3 in Trash, v2 is the latest and v1 is under it; file
 * v4 on top of v3 and v4 is the latest with v2 and v1 under it.
 *
 * Every listed row appears exactly once. A row the chains can't place (a
 * cycle, which the app never writes) is listed on its own.
 */
export function groupDocumentVersions<T extends DocumentListRow>(
  documents: T[],
  trashedLinks: DocumentVersionLink[] = [],
): DocumentVersionGroup<T>[] {
  const live = new Map(documents.map((d) => [d.id, d]));
  const supersedes = new Map<string, string | null>();
  for (const link of trashedLinks) supersedes.set(link.id, link.supersedesId);
  for (const d of documents) supersedes.set(d.id, d.supersedesId);
  // supersedesId is unique per table, so each version has at most one successor.
  const successor = new Map<string, string>();
  for (const [id, older] of supersedes) {
    if (older) successor.set(older, id);
  }

  // The nearest newer version that's listed, walking past ones in Trash.
  function hasListedSuccessor(id: string): boolean {
    const seen = new Set([id]);
    let cursor = successor.get(id);
    while (cursor && !seen.has(cursor)) {
      if (live.has(cursor)) return true;
      seen.add(cursor);
      cursor = successor.get(cursor);
    }
    return cursor !== undefined && live.has(cursor);
  }

  function olderVersions(latest: T): T[] {
    const older: T[] = [];
    const seen = new Set([latest.id]);
    let cursor = supersedes.get(latest.id) ?? null;
    while (cursor && !seen.has(cursor)) {
      const doc = live.get(cursor);
      if (doc) older.push(doc);
      seen.add(cursor);
      cursor = supersedes.get(cursor) ?? null;
    }
    return older;
  }

  const groups = new Map<string, DocumentVersionGroup<T>>();
  const placed = new Set<string>();
  for (const d of documents) {
    if (hasListedSuccessor(d.id)) continue;
    const older = olderVersions(d);
    groups.set(d.id, { latest: d, older });
    placed.add(d.id);
    for (const o of older) placed.add(o.id);
  }

  const result: DocumentVersionGroup<T>[] = [];
  for (const d of documents) {
    const group = groups.get(d.id);
    if (group) result.push(group);
    else if (!placed.has(d.id)) result.push({ latest: d, older: [] });
  }
  return result;
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

/** Image types a browser can't show inline (HEIC photos from iPhones). */
export function isBrowserViewableImage(mimeType: string): boolean {
  return mimeType.startsWith("image/") && mimeType !== "image/heic" && mimeType !== "image/heif";
}

/** Whether the row shows a thumbnail of the image instead of a file icon. */
export function showsThumbnail(doc: { category: string | null; mimeType: string }, productKind?: string | null): boolean {
  if (!isBrowserViewableImage(doc.mimeType)) return false;
  return doc.category === "PHOTO" || (!doc.category && productKind === "PHOTO");
}

/**
 * Whether an older version's row shows the star. Filing a new version
 * doesn't carry the star over, so a starred older version shows it (and can
 * be unstarred there); an unstarred one shows none, since the star belongs
 * on the latest version.
 */
export function olderVersionShowsStar(doc: { isImportant: boolean }): boolean {
  return doc.isImportant;
}
