import { prisma } from "@/lib/prisma";
import { refreshAllPortfolioPrices } from "@/lib/prices";
import { extractSearchableText } from "@/lib/documents/textExtraction";
import { readDocument, readProductDocument, readInboxDocument } from "@/lib/storage";
import { runExpirationCheck } from "@/lib/notifications/scheduler";
import { runBackup } from "@/lib/backup/scheduler";
import { runEmailIngestion } from "@/lib/emailIngestion/scheduler";
import { syncLegacyDocument } from "@/lib/items/syncLegacyDocument";
import { giveUpSearchTextJob, isSearchTextKind, processSearchTextJob, runDocumentTextBackfill } from "@/lib/documents/documentText";
import { JOB_PRIORITY } from "@/lib/jobs/priority";
import { cronOwed } from "@/lib/jobs/cronDue";
import type { ExtractionJobPayload } from "@/lib/documents/queueExtraction";

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
  | "EMAIL_INGEST"
  // #398 — extracts text from Documents filed before text search covered
  // every kind, a batch at a time; queues itself again while any are left.
  | "DOCUMENT_TEXT_BACKFILL";
export const LEASE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 3;
// #432 — a job that never settles (an S3 upload with no request timeout, a
// stalled SFTP session, a hung fetch) is given up on before its lease runs
// out, so its row is released for a retry and nothing waits on it forever.
// The work itself can't be cancelled; it is only no longer waited for.
export const JOB_TIMEOUT_MS = LEASE_MS - 30_000;

export class JobTimeoutError extends Error {
  constructor(type: string, ms: number) {
    super(`${type} job timed out after ${Math.round(ms / 1000)}s`);
    this.name = "JobTimeoutError";
  }
}

function withTimeout<T>(work: Promise<T>, ms: number, type: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new JobTimeoutError(type, ms));
    }, ms);
  });
  return Promise.race([work, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

interface EnqueueOptions {
  /** Not claimed before this. */
  availableAt?: Date;
  /** JOB_PRIORITY; higher is claimed first. */
  priority?: number;
}

export async function enqueueJob(type: JobType, payload: Record<string, unknown> = {}, options: EnqueueOptions = {}) {
  return prisma.backgroundJob.create({ data: { type, payload: JSON.stringify(payload), ...options } });
}

// Job types where only one PENDING/RUNNING instance makes sense at a time —
// as opposed to OCR_DOCUMENT, which legitimately runs many concurrently,
// one per document.
const SINGLETON_TYPES = new Set<JobType>([
  "REMINDER_CHECK",
  "BACKUP_RUN",
  "EMAIL_INGEST",
  "PRICE_REFRESH",
  "DOCUMENT_TEXT_BACKFILL",
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
export async function enqueueJobUnlessPending(type: JobType, payload: Record<string, unknown> = {}, options: EnqueueOptions = {}) {
  if (!SINGLETON_TYPES.has(type)) return enqueueJob(type, payload, options);
  try {
    return await prisma.backgroundJob.create({
      data: { type, payload: JSON.stringify(payload), activeDedupeKey: type, ...options },
    });
  } catch {
    return null; // unique constraint on activeDedupeKey — already pending or running
  }
}

/** A failed run counts as the day's run for this long, then it's tried again. */
export const FAILED_RETRY_AFTER_MS = 60 * 60_000;
/** Retries of a failed scheduled run before it waits for its next scheduled time. */
export const FAILED_RETRIES = 2;

export interface LastRun {
  at: Date;
  /** The schedule the ticker queued it under; null for a run queued by hand or before this was recorded. */
  schedule: string | null;
}

function scheduleOf(payload: string): string | null {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (parsed && typeof parsed === "object" && "schedule" in parsed && typeof parsed.schedule === "string") return parsed.schedule;
  } catch {
    // not JSON; no schedule recorded
  }
  return null;
}

/**
 * The last run of this type that a schedule should count from, by a schedule
 * or by hand; null if none. A run stamped after `now` (while the clock was
 * ahead) is ignored, or every new run would sit behind it. A run that failed
 * every attempt counts for FAILED_RETRY_AFTER_MS, so the next tick doesn't
 * retry it at once; after that the run before it counts, so the missed time
 * is owed again, up to FAILED_RETRIES times.
 */
export async function lastQueuedRun(type: JobType, now = new Date()): Promise<LastRun | null> {
  const rows = await prisma.backgroundJob.findMany({
    where: { type, createdAt: { lte: now } },
    orderBy: { createdAt: "desc" },
    take: FAILED_RETRIES + 2,
    select: { createdAt: true, status: true, payload: true },
  });
  const failedInARow = rows.findIndex((row) => row.status !== "FAILED");
  const failures = failedInARow === -1 ? rows.length : failedInARow;
  const newest = rows.at(0);
  const giveUp = failures > FAILED_RETRIES || (newest !== undefined && now.getTime() - newest.createdAt.getTime() < FAILED_RETRY_AFTER_MS);
  const counted = giveUp ? newest : rows.at(failures);
  return counted ? { at: counted.createdAt, schedule: scheduleOf(counted.payload) } : null;
}

/**
 * The scheduled-job ticker's step for one job: queue it when its schedule
 * says a run is owed (cronOwed), recording the schedule it was queued under.
 * The owed check reads the last run from the DB, and the singleton key lets
 * one run be pending at a time, so two processes, or a tick after a restart,
 * can't queue a second run for a time already run.
 */
export async function queueScheduledJob(
  type: JobType,
  pattern: string,
  now: Date,
  { savedAt = null, ...options }: EnqueueOptions & { savedAt?: Date | null } = {},
) {
  const last = await lastQueuedRun(type, now);
  const owed = await cronOwed(type, pattern, last?.at ?? null, now, { lastSchedule: last?.schedule ?? null, savedAt });
  return owed ? enqueueJobUnlessPending(type, { schedule: pattern }, options) : null;
}

async function claimJob(minPriority?: number) {
  const now = new Date();
  // A job whose last allowed attempt lost its lease (the process died, or
  // the attempt hung past LEASE_MS) can't be reclaimed below; fail it and
  // release its singleton key, or that job type could never be queued again.
  const abandoned = { status: "RUNNING", leasedUntil: { lt: now }, attempts: { gte: MAX_ATTEMPTS } };
  const lost = await prisma.backgroundJob.findMany({ where: { ...abandoned, type: "OCR_DOCUMENT" }, select: { payload: true } });
  await prisma.backgroundJob.updateMany({
    where: abandoned,
    data: { status: "FAILED", finishedAt: now, leasedUntil: null, activeDedupeKey: null, lastError: "Lease expired on the last attempt" },
  });
  for (const job of lost) await settleFailedOcr(job.payload, new Error("Lease expired on the last attempt"));
  const candidate = await prisma.backgroundJob.findFirst({
    where: {
      OR: [{ status: "PENDING", availableAt: { lte: now } }, { status: "RUNNING", leasedUntil: { lt: now } }],
      attempts: { lt: MAX_ATTEMPTS },
      ...(minPriority === undefined ? {} : { priority: { gte: minPriority } }),
    },
    // #398 review — the document text backfill's jobs run at a lower
    // priority, so they never hold up anything queued after them.
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  });
  if (!candidate) return null;
  const leasedUntil = new Date(now.getTime() + LEASE_MS);
  const result = await prisma.backgroundJob.updateMany({
    where: { id: candidate.id, OR: [{ status: "PENDING" }, { status: "RUNNING", leasedUntil: { lt: now } }] },
    data: { status: "RUNNING", attempts: { increment: 1 }, leasedUntil, startedAt: now },
  });
  return result.count === 1 ? { ...candidate, leasedUntil } : null;
}

// How long the backfill waits before its next batch; it also waits for the
// previous batch's extractions to finish.
export const BACKFILL_REQUEUE_DELAY_MS = 60_000;

interface NextRun {
  type: JobType;
  options: EnqueueOptions;
}

// Resolves to a job to queue again once this run is DONE: a singleton can't
// queue its own next run while it still holds its dedupe key.
async function executeJob(job: { type: string; payload: string }): Promise<NextRun | void> {
  if (job.type === "PRICE_REFRESH") await refreshAllPortfolioPrices();
  else if (job.type === "OCR_DOCUMENT") await processOcr(JSON.parse(job.payload));
  else if (job.type === "REMINDER_CHECK") await runExpirationCheck();
  else if (job.type === "BACKUP_RUN") await runBackup();
  else if (job.type === "EMAIL_INGEST") await runEmailIngestion();
  else if (job.type === "DOCUMENT_TEXT_BACKFILL") {
    const { more } = await runDocumentTextBackfill();
    if (more) {
      return {
        type: "DOCUMENT_TEXT_BACKFILL",
        options: { availableAt: new Date(Date.now() + BACKFILL_REQUEUE_DELAY_MS), priority: JOB_PRIORITY.BACKGROUND },
      };
    }
  }
  else throw new Error(`Unsupported job type: ${job.type}`);
}

interface RunOptions {
  timeoutMs?: number;
  /** Only claim jobs at this priority or above (JOB_PRIORITY). */
  minPriority?: number;
  /**
   * runPendingJobs only: stop claiming new jobs once this long has passed
   * since it started. A job already running isn't cut short, and what's left
   * stays queued for the next call or the in-process runner.
   */
  budgetMs?: number;
}

export async function runOneJob(options: RunOptions = {}) {
  const job = await claimJob(options.minPriority);
  if (!job) return false;
  try {
    const next = await withTimeout(executeJob(job), options.timeoutMs ?? JOB_TIMEOUT_MS, job.type);
    await prisma.backgroundJob.update({
      where: { id: job.id },
      data: { status: "DONE", finishedAt: new Date(), leasedUntil: null, activeDedupeKey: null },
    });
    if (next) await enqueueJobUnlessPending(next.type, {}, next.options);
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
    if (failedTerminally && job.type === "OCR_DOCUMENT") await settleFailedOcr(job.payload, error);
  }
  return true;
}

// #398 review — a Document whose extraction has used its last attempt
// leaves PENDING, so it isn't stuck there with nothing queued for it.
async function settleFailedOcr(payload: string, error: unknown) {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (isSearchTextKind((parsed as { kind?: unknown } | null)?.kind)) await giveUpSearchTextJob(parsed, error);
  } catch (settleError) {
    console.error("[jobs] couldn't settle a failed text extraction", settleError);
  }
}

async function processOcr(payload: ExtractionJobPayload) {
  if (isSearchTextKind(payload.kind)) return processSearchTextJob(payload);
  const buffer = payload.kind === "contract" ? await readDocument(payload.ownerId!, payload.storedName) : payload.kind === "product" ? await readProductDocument(payload.ownerId!, payload.storedName) : await readInboxDocument(payload.storedName);
  const text = await extractSearchableText(buffer, payload.mimeType);
  if (payload.kind === "contract") await prisma.document.update({ where: { id: payload.id }, data: { extractedText: text, extractionStatus: text ? "COMPLETED" : "FAILED" } });
  else if (payload.kind === "product") {
    await prisma.productDocument.update({ where: { id: payload.id }, data: { extractedText: text, extractionStatus: text ? "COMPLETED" : "FAILED" } });
    // Not caught (#445 review): a failed mirror fails the job, so it is
    // retried rather than leaving the staged copy with stale text.
    await syncLegacyDocument("PRODUCT", payload.id);
  }
  else await prisma.inboxDocument.update({ where: { id: payload.id }, data: { extractedText: text, extractionStatus: text ? "COMPLETED" : "FAILED" } });
}

export async function runPendingJobs(limit = 4, options: RunOptions = {}): Promise<void> {
  const startedAt = Date.now();
  for (let i = 0; i < limit; i += 1) {
    if (options.budgetMs !== undefined && Date.now() - startedAt >= options.budgetMs) break;
    if (!(await runOneJob(options))) break;
  }
}

/**
 * #432 — the 20s job-processor tick (instrumentation.ts). A tick that
 * arrives while the previous one is still running is skipped, so slow
 * ticks don't stack up queries behind each other, but only for up to
 * LEASE_MS: a tick stuck longer than that no longer holds the processor.
 */
export function createJobTick(
  run: () => Promise<void> = () => runPendingJobs(),
  options: { maxBusyMs?: number; now?: () => number } = {},
): () => Promise<void> {
  const maxBusyMs = options.maxBusyMs ?? LEASE_MS;
  const now = options.now ?? Date.now;
  let busySince: number | null = null;
  return async () => {
    if (busySince !== null && now() - busySince < maxBusyMs) return;
    const startedAt = now();
    busySince = startedAt;
    try {
      await run();
    } catch (error) {
      console.error("[jobs] scheduled job processing failed:", error);
    } finally {
      // A newer tick may have taken over from a stuck one; leave its marker.
      if (busySince === startedAt) busySince = null;
    }
  };
}
