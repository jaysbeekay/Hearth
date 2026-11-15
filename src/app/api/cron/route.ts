import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cronSecretMatches } from "@/lib/cronSecret";
import { enqueueJobUnlessPending, runPendingJobs, type JobType } from "@/lib/jobs/runner";
import { queueOwedScheduledJobs } from "@/lib/jobs/owed";
import { JOB_PRIORITY } from "@/lib/jobs/priority";

// How long one request spends starting jobs. A job already running isn't cut
// short, and anything left stays queued for the next call or the in-process
// job runner, so a slow backup can't make every later job in the request wait.
const DRAIN_BUDGET_MS = 30_000;

// External trigger for every scheduled job, for self-hosters who prefer a
// systemd timer, host cron or a NAS task scheduler over the built-in ticker
// (or alongside it).
//
// #250 — routes through the same enqueue-then-lease-claim path the internal
// scheduled ticker uses (src/instrumentation.ts), rather than calling
// runExpirationCheck() directly the way this endpoint used to, so a
// concurrent scheduled tick and an external trigger can't double-run a job.
//
// #481 — and through the same "what's owed" decision as that ticker
// (queueOwedScheduledJobs), so one call also queues the backup, email ingest
// and price refresh when they're due, not only the reminder check.
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Set CRON_SECRET to enable this endpoint" },
      { status: 404 },
    );
  }

  if (!cronSecretMatches(request.headers.get("x-cron-secret"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The reminder check runs on every call, owed or not: it's this endpoint's
  // long-standing "run it now", and it only sends what hasn't been sent.
  const job = await enqueueJobUnlessPending("REMINDER_CHECK");
  const enqueued: JobType[] = await queueOwedScheduledJobs();
  if (job && !enqueued.includes("REMINDER_CHECK")) enqueued.unshift("REMINDER_CHECK");

  // Only normal-priority work: the document text backfill (#398) can keep
  // hours of OCR queued, which the in-process runner works through, and an
  // external scheduler's request shouldn't wait on it.
  await runPendingJobs(50, { minPriority: JOB_PRIORITY.NORMAL, budgetMs: DRAIN_BUDGET_MS });

  const settled = await prisma.backgroundJob.findUnique({
    where: { id: job?.id ?? "" },
    select: { status: true, lastError: true },
  });
  return NextResponse.json({
    triggered: "REMINDER_CHECK",
    status: settled?.status ?? "ALREADY_PENDING",
    error: settled?.lastError ?? undefined,
    enqueued,
  });
}
