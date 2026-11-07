import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { documentStoreFor } from "@/lib/storage";
import {
  extractTextDetailed,
  getExtractionCapabilities,
  MAX_SEARCHABLE_TEXT_LENGTH,
  withExtractionSlot,
  type ExtractionCapabilities,
} from "@/lib/documents/textExtraction";
import { JOB_PRIORITY } from "@/lib/jobs/priority";
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

export function isSearchTextKind(kind: unknown): kind is SearchTextKind {
  return typeof kind === "string" && (SEARCH_TEXT_KINDS as readonly string[]).includes(kind);
}

/** Only PDFs and images go through pdftotext/OCR; anything else has no text to find. */
export function hasExtractableText(mimeType: string): boolean {
  return mimeType === "application/pdf" || mimeType.startsWith("image/");
}

/**
 * extractionStatus for these kinds:
 * - NULL: not looked at yet (filed before #398, or a queueing failure); the
 *   backfill picks it up.
 * - PENDING: an OCR_DOCUMENT job is queued for it.
 * - COMPLETED: has its text, or isn't a PDF or image.
 * - FAILED: extraction ran and found no text, or kept failing; not retried.
 * - UNAVAILABLE: the tools its type needs (pdftotext/pdftoppm/tesseract)
 *   weren't installed; the backfill retries it once they are.
 */
export const EXTRACTION_UNAVAILABLE = "UNAVAILABLE";

/** Thrown when the server lacks the tools a file needs, so the job retries and logs why. */
export class ExtractionToolsUnavailableError extends Error {
  constructor(mimeType: string) {
    super(`Text extraction tools for ${mimeType} aren't installed (pdftotext, pdftoppm, tesseract)`);
    this.name = "ExtractionToolsUnavailableError";
  }
}

// Same tradeoff as the Document command: each delegate has its own
// generated types, and only the shared columns are used.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Delegate = any;
type Client = typeof prisma | Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

const TABLES: Record<SearchTextKind, { model: string; ownerField: string }> = {
  TRIP_SEGMENT: { model: "tripSegmentDocument", ownerField: "tripSegmentId" },
  RENTAL_STATEMENT: { model: "rentalStatementDocument", ownerField: "rentalStatementId" },
  HOME_ITEM: { model: "homeItemDocument", ownerField: "homeItemId" },
  VEHICLE_ITEM: { model: "vehicleItemDocument", ownerField: "vehicleItemId" },
  TRADE: { model: "tradeDocument", ownerField: "tradeId" },
};

function delegate(kind: SearchTextKind, client: Client = prisma): Delegate {
  return (client as unknown as Record<string, Delegate>)[TABLES[kind].model];
}

const searchTextJobSchema = z.object({
  kind: z.enum(SEARCH_TEXT_KINDS),
  id: z.string().min(1),
  ownerId: z.string().min(1),
  storedName: z.string().min(1),
  mimeType: z.string().min(1),
});
export type SearchTextJob = z.infer<typeof searchTextJobSchema>;

/**
 * An OCR_DOCUMENT job for one of these kinds: reads the file, extracts its
 * text and stores it, which the table's FTS trigger copies into the search
 * index. Throws (so the job is retried and the error logged) when the file
 * can't be read, extraction crashes, or the tools aren't installed.
 */
export async function processSearchTextJob(payload: unknown): Promise<void> {
  const job = searchTextJobSchema.parse(payload);
  // Purged since it was queued: nothing to do, and no error to retry.
  const row = await delegate(job.kind).findUnique({ where: { id: job.id }, select: { id: true } });
  if (!row) return;
  const buffer = await documentStoreFor(job.kind).read(job.ownerId, job.storedName);
  const caps = await getExtractionCapabilities();
  const result = await withExtractionSlot(() => extractTextDetailed(buffer, job.mimeType));
  if (result.unavailable) {
    // The check said the tool was there but running it failed (a sandbox, a
    // broken library): a plain failure, so it ends FAILED rather than coming
    // back every time the check passes again.
    if (toolsReported(caps, job.mimeType)) throw new Error(`Text extraction tools for ${job.mimeType} are installed but couldn't be run`);
    throw new ExtractionToolsUnavailableError(job.mimeType);
  }
  const text = result.text.trim().slice(0, MAX_SEARCHABLE_TEXT_LENGTH) || null;
  await delegate(job.kind).updateMany({
    where: { id: job.id },
    data: { extractedText: text, extractionStatus: text ? "COMPLETED" : "FAILED" },
  });
}

/**
 * After an OCR_DOCUMENT job for one of these kinds has used its last
 * attempt: the Document leaves PENDING, as UNAVAILABLE when the tools were
 * missing (retried once they're installed) or FAILED otherwise.
 */
export async function giveUpSearchTextJob(payload: unknown, error: unknown): Promise<void> {
  const job = searchTextJobSchema.safeParse(payload);
  if (!job.success) return;
  await delegate(job.data.kind).updateMany({
    where: { id: job.data.id, extractionStatus: "PENDING" },
    data: { extractionStatus: error instanceof ExtractionToolsUnavailableError ? EXTRACTION_UNAVAILABLE : "FAILED" },
  });
}

/** Whether the tools that could have been missing for this type were reported installed. */
function toolsReported(caps: ExtractionCapabilities, mimeType: string): boolean {
  if (mimeType === "application/pdf") return caps.pdfOcr;
  return caps.imageOcr;
}

export const BACKFILL_BATCH_SIZE = 25;
/** A PENDING Document this old with nothing queued for it is picked up again. */
export const ORPHAN_PENDING_MS = 60 * 60_000;
/** Finished backfill runs are kept this long, then cleared from the job table. */
const BACKFILL_HISTORY_MS = 7 * 24 * 60 * 60_000;

const PDF = { mimeType: "application/pdf" };
const IMAGE = { mimeType: { startsWith: "image/" } };

/**
 * The Documents the backfill can settle with the tools this server has. One
 * whose tools are missing stays as it is, so it neither blocks the batches
 * nor fails over and over; an UNAVAILABLE one comes back once its tools are
 * installed. Documents in Trash are left for a later batch, once restored.
 */
function pickableWhere(caps: ExtractionCapabilities) {
  const or: Record<string, unknown>[] = [{ extractionStatus: null, NOT: [PDF, IMAGE] }];
  if (caps.pdfText || caps.pdfOcr) or.push({ extractionStatus: null, ...PDF });
  // Only once OCR is there: an UNAVAILABLE PDF needed OCR, or was marked
  // while no PDF tool was installed. The second kind also waits for OCR,
  // even if only pdftotext is installed later; retrying it on pdftotext
  // alone would send every scan back through three failing attempts.
  if (caps.pdfOcr) or.push({ extractionStatus: EXTRACTION_UNAVAILABLE, ...PDF });
  if (caps.imageOcr) {
    or.push({ extractionStatus: null, ...IMAGE }, { extractionStatus: EXTRACTION_UNAVAILABLE, ...IMAGE });
  }
  return { deletedAt: null, OR: or };
}

/**
 * One batch of the DOCUMENT_TEXT_BACKFILL job. Each Document found is
 * settled the way a new upload is (a PDF or image is queued for
 * extraction, anything else has no text), its status and its job written
 * together, so it's never picked up twice or left PENDING with no job.
 * The next batch waits until this one's extractions have finished, so the
 * queue never holds more than one batch. Returns whether to run again.
 */
export async function runDocumentTextBackfill(): Promise<{ more: boolean }> {
  await prisma.backgroundJob.deleteMany({
    where: { type: "DOCUMENT_TEXT_BACKFILL", status: "DONE", finishedAt: { lt: new Date(Date.now() - BACKFILL_HISTORY_MS) } },
  });
  const inFlight = await prisma.backgroundJob.count({
    where: { type: "OCR_DOCUMENT", priority: JOB_PRIORITY.BACKGROUND, status: { in: ["PENDING", "RUNNING"] } },
  });
  if (inFlight > 0) return { more: true };

  await releaseOrphanedPending();
  const where = pickableWhere(await getExtractionCapabilities());
  let left = BACKFILL_BATCH_SIZE;
  for (const kind of SEARCH_TEXT_KINDS) {
    if (left === 0) break;
    const { ownerField } = TABLES[kind];
    const rows: { id: string; storedName: string; mimeType: string; [owner: string]: string }[] = await delegate(kind).findMany({
      where,
      select: { id: true, storedName: true, mimeType: true, [ownerField]: true },
      orderBy: { uploadedAt: "asc" },
      take: left,
    });
    for (const row of rows) {
      if (!hasExtractableText(row.mimeType)) {
        await delegate(kind).update({ where: { id: row.id }, data: { extractionStatus: "COMPLETED" } });
        continue;
      }
      const job: SearchTextJob = { kind, id: row.id, ownerId: row[ownerField], storedName: row.storedName, mimeType: row.mimeType };
      await prisma.$transaction(async (tx) => {
        await delegate(kind, tx).update({ where: { id: row.id }, data: { extractionStatus: "PENDING" } });
        await tx.backgroundJob.create({
          data: { type: "OCR_DOCUMENT", payload: JSON.stringify(job), priority: JOB_PRIORITY.BACKGROUND },
        });
      });
    }
    left -= rows.length;
  }
  for (const kind of SEARCH_TEXT_KINDS) {
    if (await delegate(kind).findFirst({ where, select: { id: true } })) return { more: true };
  }
  return { more: false };
}

/** Back to "not looked at", for a Document whose extraction couldn't be queued. */
export async function resetSearchTextStatus(kind: SearchTextKind, id: string): Promise<void> {
  await delegate(kind).updateMany({ where: { id, extractionStatus: "PENDING" }, data: { extractionStatus: null } });
}

/**
 * A Document left PENDING with no extraction job for it (the process died
 * between filing it and queueing its job, a settle that failed, a rollback
 * whose older build failed its job) goes back to "not looked at", so this
 * batch picks it up. Only once it's an hour old, so a job that's about to be
 * queued isn't raced.
 */
async function releaseOrphanedPending(): Promise<void> {
  const before = new Date(Date.now() - ORPHAN_PENDING_MS);
  for (const kind of SEARCH_TEXT_KINDS) {
    const rows: { id: string }[] = await delegate(kind).findMany({
      where: { extractionStatus: "PENDING", deletedAt: null, uploadedAt: { lt: before } },
      select: { id: true },
      orderBy: { uploadedAt: "asc" },
      take: BACKFILL_BATCH_SIZE,
    });
    for (const row of rows) {
      const live = await prisma.backgroundJob.count({
        where: {
          type: "OCR_DOCUMENT",
          status: { in: ["PENDING", "RUNNING"] },
          payload: { contains: `"id":${JSON.stringify(row.id)}` },
        },
      });
      if (live === 0) await resetSearchTextStatus(kind, row.id);
    }
  }
}
