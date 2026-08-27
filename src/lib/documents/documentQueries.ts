import { prisma } from "@/lib/prisma";

// A single read layer across all 9 document tables (see CLAUDE.md's
// "document AI-extraction pipeline" note — each domain has its own document
// model). Without this, every cross-cutting document feature (duplicate
// detection, version history, "important" filtering) would need to be
// implemented and tested once per table. This module is deliberately
// read-only and additive: it doesn't touch how any existing page queries its
// own document list.
export type DocumentKind =
  | "CONTRACT"
  | "PRODUCT"
  | "TRIP_SEGMENT"
  | "RENTAL_STATEMENT"
  | "HOME_ITEM"
  | "VEHICLE_ITEM"
  | "INVENTORY_ITEM"
  | "TRADE"
  | "INBOX";

export interface DocumentRef {
  kind: DocumentKind;
  id: string;
  /** The id of the record this document is attached to. Null for Inbox documents, which have no filed owner yet. */
  ownerId: string | null;
  filename: string;
  size: number;
  sha256: string | null;
  isImportant: boolean;
  supersedesId: string | null;
  uploadedAt: Date;
}

const SELECT = {
  id: true,
  filename: true,
  size: true,
  sha256: true,
  isImportant: true,
  supersedesId: true,
  uploadedAt: true,
} as const;

// InboxDocument has no isImportant/supersedesId columns — "important" and
// "version history" are both filed-record concepts that don't apply before
// a document has been classified (#199/#206).
const INBOX_SELECT = {
  id: true,
  filename: true,
  size: true,
  sha256: true,
  uploadedAt: true,
} as const;

interface RawRow {
  id: string;
  filename: string;
  size: number;
  sha256: string | null;
  isImportant?: boolean;
  supersedesId?: string | null;
  uploadedAt: Date;
  [ownerField: string]: unknown;
}

interface TableConfig {
  kind: DocumentKind;
  ownerField: string | null;
  // Each of the 9 Prisma delegates has a distinct generated where/select
  // type, so this dispatch table can't be expressed with one shared Prisma
  // type without either duplicating each delegate's types here or fighting
  // the generated client's structural typing — same tradeoff already made
  // for the yahoo-finance calls in src/lib/prices.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findMany: (where: Record<string, unknown>) => Promise<any[]>;
}

const TABLES: TableConfig[] = [
  {
    kind: "CONTRACT",
    ownerField: "contractId",
    findMany: (where) => prisma.document.findMany({ where, select: { ...SELECT, contractId: true } }),
  },
  {
    kind: "PRODUCT",
    ownerField: "productId",
    findMany: (where) => prisma.productDocument.findMany({ where, select: { ...SELECT, productId: true } }),
  },
  {
    kind: "TRIP_SEGMENT",
    ownerField: "tripSegmentId",
    findMany: (where) => prisma.tripSegmentDocument.findMany({ where, select: { ...SELECT, tripSegmentId: true } }),
  },
  {
    kind: "RENTAL_STATEMENT",
    ownerField: "rentalStatementId",
    findMany: (where) =>
      prisma.rentalStatementDocument.findMany({ where, select: { ...SELECT, rentalStatementId: true } }),
  },
  {
    kind: "HOME_ITEM",
    ownerField: "homeItemId",
    findMany: (where) => prisma.homeItemDocument.findMany({ where, select: { ...SELECT, homeItemId: true } }),
  },
  {
    kind: "VEHICLE_ITEM",
    ownerField: "vehicleItemId",
    findMany: (where) => prisma.vehicleItemDocument.findMany({ where, select: { ...SELECT, vehicleItemId: true } }),
  },
  {
    kind: "INVENTORY_ITEM",
    ownerField: "inventoryItemId",
    findMany: (where) =>
      prisma.inventoryItemDocument.findMany({ where, select: { ...SELECT, inventoryItemId: true } }),
  },
  {
    kind: "TRADE",
    ownerField: "tradeId",
    findMany: (where) => prisma.tradeDocument.findMany({ where, select: { ...SELECT, tradeId: true } }),
  },
  {
    kind: "INBOX",
    ownerField: null,
    findMany: (where) => prisma.inboxDocument.findMany({ where, select: INBOX_SELECT }),
  },
];

function toRef(kind: DocumentKind, ownerField: string | null, row: RawRow): DocumentRef {
  return {
    kind,
    id: row.id,
    ownerId: ownerField ? (row[ownerField] as string) : null,
    filename: row.filename,
    size: row.size,
    sha256: row.sha256 ?? null,
    isImportant: row.isImportant ?? false,
    supersedesId: row.supersedesId ?? null,
    uploadedAt: row.uploadedAt,
  };
}

/**
 * Cross-table exact-hash lookup — the high-precision duplicate signal from
 * #206. Deliberately hash-only (no fuzzy text matching): a false-positive
 * duplicate prompt interrupts an upload mid-task, which is worse than an
 * occasional miss.
 */
export async function findDocumentsByHash(sha256: string): Promise<DocumentRef[]> {
  const results = await Promise.all(
    TABLES.map(async (t) => (await t.findMany({ sha256 })).map((row) => toRef(t.kind, t.ownerField, row))),
  );
  return results.flat();
}

/**
 * Same lookup as findDocumentsByHash, batched across every hash needed at
 * once — #252: the inbox page previously called findDocumentsByHash once
 * per POSSIBLE_DUPLICATE row, so N pending duplicates meant N × 9 queries.
 * This is 9 queries total regardless of N, each filtered with `sha256 IN
 * (...)` against the same sha256 index findDocumentsByHash already uses.
 */
export async function findDocumentsByHashBatch(
  hashes: string[],
): Promise<Map<string, DocumentRef[]>> {
  const uniqueHashes = [...new Set(hashes)];
  const byHash = new Map<string, DocumentRef[]>(uniqueHashes.map((h) => [h, []]));
  if (uniqueHashes.length === 0) return byHash;

  const results = await Promise.all(
    TABLES.map(async (t) =>
      (await t.findMany({ sha256: { in: uniqueHashes } })).map((row) => ({
        ref: toRef(t.kind, t.ownerField, row),
        sha256: row.sha256 as string,
      })),
    ),
  );

  for (const { ref, sha256 } of results.flat()) {
    byHash.get(sha256)?.push(ref);
  }
  return byHash;
}

/**
 * Walks a document's version chain within its own table, oldest first —
 * backward through `supersedesId` to the original upload, then forward to
 * find whatever most recently superseded the given document (if anything).
 */
export async function getDocumentVersionChain(kind: DocumentKind, id: string): Promise<DocumentRef[]> {
  const table = TABLES.find((t) => t.kind === kind);
  if (!table) return [];

  const seen = new Set<string>();
  const chain: DocumentRef[] = [];

  let cursorId: string | null = id;
  while (cursorId && !seen.has(cursorId)) {
    seen.add(cursorId);
    const [row] = await table.findMany({ id: cursorId });
    if (!row) break;
    const ref = toRef(table.kind, table.ownerField, row);
    chain.unshift(ref);
    cursorId = ref.supersedesId;
  }

  let cursor = chain[chain.length - 1]?.id;
  while (cursor) {
    const [row] = await table.findMany({ supersedesId: cursor });
    if (!row) break;
    const ref = toRef(table.kind, table.ownerField, row);
    if (seen.has(ref.id)) break;
    seen.add(ref.id);
    chain.push(ref);
    cursor = ref.id;
  }

  return chain;
}
