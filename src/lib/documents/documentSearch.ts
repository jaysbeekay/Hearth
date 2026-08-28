import { prisma } from "@/lib/prisma";
import type { DocumentKind } from "./documentQueries";

// #314 — ranked, indexed search across all 9 document tables' filename and
// extracted-text content, backed by the document_search_fts FTS5 virtual
// table (prisma/migrations/20260828000000_add_document_search_fts), kept in
// sync by SQL triggers rather than application code — see that migration's
// comments for why. A sibling to documentQueries.ts rather than folded into
// it: that module is explicitly read-only/additive for a different concern
// (hash-based dedup, version-chain walking), and FTS querying has its own
// raw-SQL escaping/query-construction surface that deserves separation.

export interface DocumentSearchHit {
  kind: DocumentKind;
  docId: string;
  ownerId: string | null;
  filename: string;
}

// SQLite's FTS5 query grammar treats ", *, -, :, and bareword AND/OR/NOT as
// syntax, not literal text — passed through unescaped, an ordinary-looking
// query (a bare "-" is common) throws `fts5: syntax error`. Doubling any
// embedded double-quote and wrapping the whole string in one top-level
// phrase literal neutralizes all of that, and — combined with the
// document_search_fts table's `trigram` tokenizer — is also exactly the form
// needed to get true substring matching, matching what the `contains` scans
// this replaces already did.
export function escapeFtsMatchQuery(query: string): string {
  return `"${query.replace(/"/g, '""')}"`;
}

interface SearchOptions {
  kinds?: DocumentKind[];
  limit?: number;
}

const DEFAULT_LIMIT = 60;

/**
 * Ranked FTS5 search across every document kind's filename/extracted text.
 * Returns bare hits — callers are responsible for resolving each hit's
 * docId back through its own Prisma delegate (for owner-liveness filtering,
 * e.g. excluding a soft-deleted contract's documents) and re-sorting the
 * survivors back into this function's rank order, since that resolution
 * step can drop hits.
 */
export async function searchDocumentsFts(
  query: string,
  opts: SearchOptions = {},
): Promise<DocumentSearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const limit = opts.limit ?? DEFAULT_LIMIT;
  const matchExpr = escapeFtsMatchQuery(trimmed);

  const kindFilter = opts.kinds?.length ? `AND kind IN (${opts.kinds.map(() => "?").join(", ")})` : "";
  const args: unknown[] = [matchExpr, ...(opts.kinds ?? []), limit];

  const rows = await prisma.$queryRawUnsafe<
    { kind: DocumentKind; ownerId: string | null; docId: string; filename: string }[]
  >(
    `SELECT kind, ownerId, docId, filename FROM document_search_fts
     WHERE document_search_fts MATCH ? ${kindFilter}
     ORDER BY bm25(document_search_fts, 3.0, 1.0)
     LIMIT ?`,
    ...args,
  );

  return rows.map((r) => ({ kind: r.kind, docId: r.docId, ownerId: r.ownerId, filename: r.filename }));
}

/** Distinct ownerIds among this kind's hits — used to fold document-content
 * matches into a Contract/Product's own record-search `OR` clause. */
export function hitOwnerIds(hits: DocumentSearchHit[], kind: DocumentKind): string[] {
  return [...new Set(hits.filter((h) => h.kind === kind && h.ownerId).map((h) => h.ownerId as string))];
}

/** This kind's matching document ids — used to resolve full rows (with
 * owner-liveness filters) via each kind's own Prisma delegate. */
export function hitDocIds(hits: DocumentSearchHit[], kind: DocumentKind): string[] {
  return hits.filter((h) => h.kind === kind).map((h) => h.docId);
}

/**
 * Re-sorts a resolved subset of rows back into the original FTS rank order
 * — needed because owner-liveness resolution (`id IN (...)`) doesn't
 * preserve MATCH ranking, and can drop hits entirely.
 */
export function sortByHitRank<T extends { id: string }>(rows: T[], hits: DocumentSearchHit[]): T[] {
  const rank = new Map(hits.map((h, i) => [h.docId, i]));
  return [...rows].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
}
