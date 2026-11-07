import { prisma } from "@/lib/prisma";
import { documentStoreFor } from "@/lib/storage";
import type { OwnedDocumentKind } from "@/lib/documents/kinds";

// #398 — the Document kinds whose text is extracted only so Search can find
// them by content. Contracts and Products have their own extraction (it
// also feeds field extraction); Inventory items move to Item Documents
// (#380), which already carry text.
export const SEARCH_TEXT_KINDS = [
  "TRIP_SEGMENT",
  "RENTAL_STATEMENT",
  "HOME_ITEM",
  "VEHICLE_ITEM",
  "TRADE",
] as const satisfies readonly OwnedDocumentKind[];
export type SearchTextKind = (typeof SEARCH_TEXT_KINDS)[number];

export function isSearchTextKind(kind: string): kind is SearchTextKind {
  return (SEARCH_TEXT_KINDS as readonly string[]).includes(kind);
}

/** Only PDFs and images go through pdftotext/OCR; anything else has no text to find. */
export function hasExtractableText(mimeType: string): boolean {
  return mimeType === "application/pdf" || mimeType.startsWith("image/");
}

// Same tradeoff as the Document command: each delegate has its own
// generated types, and only the shared columns are used.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Delegate = any;

const TABLES: Record<SearchTextKind, { delegate: () => Delegate; ownerField: string }> = {
  TRIP_SEGMENT: { delegate: () => prisma.tripSegmentDocument, ownerField: "tripSegmentId" },
  RENTAL_STATEMENT: { delegate: () => prisma.rentalStatementDocument, ownerField: "rentalStatementId" },
  HOME_ITEM: { delegate: () => prisma.homeItemDocument, ownerField: "homeItemId" },
  VEHICLE_ITEM: { delegate: () => prisma.vehicleItemDocument, ownerField: "vehicleItemId" },
  TRADE: { delegate: () => prisma.tradeDocument, ownerField: "tradeId" },
};

export function readSearchTextFile(kind: SearchTextKind, ownerId: string, storedName: string) {
  return documentStoreFor(kind).read(ownerId, storedName);
}

export async function saveSearchText(kind: SearchTextKind, id: string, text: string | null) {
  await TABLES[kind].delegate().update({
    where: { id },
    data: { extractedText: text, extractionStatus: text ? "COMPLETED" : "FAILED" },
  });
}

export const BACKFILL_BATCH_SIZE = 25;

export interface SearchTextJob {
  kind: SearchTextKind;
  id: string;
  ownerId: string;
  storedName: string;
  mimeType: string;
}

/**
 * One batch of the DOCUMENT_TEXT_BACKFILL job: Documents filed before #398
 * still have a NULL extractionStatus. Each one found is settled the way a
 * new upload is (a PDF or image is queued for extraction, anything else has
 * no text), so it's never picked up twice. Documents in Trash are left
 * NULL, for a later batch once they're restored. Returns whether any are
 * left, so the runner can queue the next batch.
 *
 * The runner passes `queue` in: this module is imported by the runner, so
 * it can't import the job queue itself.
 */
export async function runDocumentTextBackfill(queue: (job: SearchTextJob) => Promise<unknown>): Promise<{ more: boolean }> {
  const waiting = { extractionStatus: null, deletedAt: null };
  let left = BACKFILL_BATCH_SIZE;
  for (const kind of SEARCH_TEXT_KINDS) {
    if (left === 0) break;
    const { delegate, ownerField } = TABLES[kind];
    const rows: { id: string; storedName: string; mimeType: string; [owner: string]: string }[] = await delegate().findMany({
      where: waiting,
      select: { id: true, storedName: true, mimeType: true, [ownerField]: true },
      orderBy: { uploadedAt: "asc" },
      take: left,
    });
    for (const row of rows) {
      if (hasExtractableText(row.mimeType)) {
        await delegate().update({ where: { id: row.id }, data: { extractionStatus: "PENDING" } });
        await queue({ kind, id: row.id, ownerId: row[ownerField], storedName: row.storedName, mimeType: row.mimeType });
      } else {
        await delegate().update({ where: { id: row.id }, data: { extractionStatus: "COMPLETED" } });
      }
    }
    left -= rows.length;
  }
  const remaining = await Promise.all(SEARCH_TEXT_KINDS.map((kind) => TABLES[kind].delegate().count({ where: waiting })));
  return { more: remaining.some((n: number) => n > 0) };
}
