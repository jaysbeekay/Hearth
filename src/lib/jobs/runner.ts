import { prisma } from "@/lib/prisma";
import { refreshAllPortfolioPrices } from "@/lib/prices";
import { extractSearchableText } from "@/lib/documents/textExtraction";
import { readDocument, readProductDocument, readInboxDocument } from "@/lib/storage";
import { runExpirationCheck } from "@/lib/notifications/scheduler";
import { runBackup } from "@/lib/backup/scheduler";
import { runEmailIngestion } from "@/lib/emailIngestion/scheduler";

// #250 — REMINDER_CHECK/BACKUP_RUN/EMAIL_INGEST join PRICE_REFRESH/
// OCR_DOCUMENT on this same DB-leased runner, replacing the direct
// cron.schedule(fn) registrations in instrumentation.ts that ran on
// whichever process happened to have booted first, with no lease and no
// way to change schedule without a restart.
export type JobType =
  | "PRICE_REFRESH"
  | "OCR_DOCUMENT"
  | "REMINDER_CHECK"
  | "BACKUP_RUN"
  | "EMAIL_INGEST";
const LEASE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 3;

export async function enqueueJob(type: JobType, payload: Record<string, unknown> = {}) {
  return prisma.backgroundJob.create({ data: { type, payload: JSON.stringify(payload) } });
}

// Job types where only one PENDING/RUNNING instance makes sense at a time —
// as opposed to OCR_DOCUMENT, which legitimately runs many concurrently,
// one per document.
const SINGLETON_TYPES = new Set<JobType>([
  "REMINDER_CHECK",
  "BACKUP_RUN",
  "EMAIL_INGEST",
  "PRICE_REFRESH",
]);

// Used by the scheduled-job ticker (instrumentation.ts) and /api/cron — a
// tick or an external trigger arriving while the previous run of the same
// job type is still PENDING or RUNNING shouldn't queue a second one.
//
// A findFirst-then-create check has a race: two calls landing close
// together could both see "nothing pending" before either has committed.
// activeDedupeKey's unique index (set to `type` for singleton types) makes
// the losing create() fail at insert time instead — the same atomic-claim
// technique #249's SyncOperationReceipt uses for /api/sync. The key is
// cleared back to null in runOneJob() once the job leaves PENDING/RUNNING,
// so a later, genuinely new run isn't blocked by this one's completed row.
export async function enqueueJobUnlessPending(type: JobType, payload: Record<string, unknown> = {}) {
  if (!SINGLETON_TYPES.has(type)) return enqueueJob(type, payload);
  try {
    return await prisma.backgroundJob.create({
      data: { type, payload: JSON.stringify(payload), activeDedupeKey: type },
    });
  } catch {
    return null; // unique constraint on activeDedupeKey — already pending or running
  }
}

async function claimJob() {
  const now = new Date();
  const candidate = await prisma.backgroundJob.findFirst({
    where: { OR: [{ status: "PENDING", availableAt: { lte: now } }, { status: "RUNNING", leasedUntil: { lt: now } }], attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: "asc" },
  });
  if (!candidate) return null;
  const leasedUntil = new Date(now.getTime() + LEASE_MS);
  const result = await prisma.backgroundJob.updateMany({
    where: { id: candidate.id, OR: [{ status: "PENDING" }, { status: "RUNNING", leasedUntil: { lt: now } }] },
    data: { status: "RUNNING", attempts: { increment: 1 }, leasedUntil, startedAt: now },
  });
  return result.count === 1 ? { ...candidate, leasedUntil } : null;
}

export async function runOneJob() {
  const job = await claimJob();
  if (!job) return false;
  try {
    if (job.type === "PRICE_REFRESH") await refreshAllPortfolioPrices();
    else if (job.type === "OCR_DOCUMENT") await processOcr(JSON.parse(job.payload));
    else if (job.type === "REMINDER_CHECK") await runExpirationCheck();
    else if (job.type === "BACKUP_RUN") await runBackup();
    else if (job.type === "EMAIL_INGEST") await runEmailIngestion();
    else throw new Error(`Unsupported job type: ${job.type}`);
    await prisma.backgroundJob.update({
      where: { id: job.id },
      data: { status: "DONE", finishedAt: new Date(), leasedUntil: null, activeDedupeKey: null },
    });
  } catch (error) {
    const failedTerminally = job.attempts + 1 >= MAX_ATTEMPTS;
    await prisma.backgroundJob.update({
      where: { id: job.id },
      data: {
        status: failedTerminally ? "FAILED" : "PENDING",
        availableAt: new Date(Date.now() + 30_000),
        leasedUntil: null,
        lastError: error instanceof Error ? error.message : "Unknown error",
        // Only released once retries are exhausted — while it may still
        // retry, this IS the active attempt for that singleton type.
        activeDedupeKey: failedTerminally ? null : job.activeDedupeKey,
      },
    });
  }
  return true;
}

async function processOcr(payload: { kind: "contract" | "product" | "inbox"; id: string; ownerId?: string; storedName: string; mimeType: string }) {
  const buffer = payload.kind === "contract" ? await readDocument(payload.ownerId!, payload.storedName) : payload.kind === "product" ? await readProductDocument(payload.ownerId!, payload.storedName) : await readInboxDocument(payload.storedName);
  const text = await extractSearchableText(buffer, payload.mimeType);
  if (payload.kind === "contract") await prisma.document.update({ where: { id: payload.id }, data: { extractedText: text, extractionStatus: text ? "COMPLETED" : "FAILED" } });
  else if (payload.kind === "product") await prisma.productDocument.update({ where: { id: payload.id }, data: { extractedText: text, extractionStatus: text ? "COMPLETED" : "FAILED" } });
  else await prisma.inboxDocument.update({ where: { id: payload.id }, data: { extractedText: text, extractionStatus: text ? "COMPLETED" : "FAILED" } });
}

export async function runPendingJobs(limit = 4) {
  for (let i = 0; i < limit; i += 1) {
    if (!(await runOneJob())) break;
  }
}
