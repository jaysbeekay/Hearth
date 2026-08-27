import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enqueueJobUnlessPending, runPendingJobs } from "@/lib/jobs/runner";

// Manual/external trigger for the expiration check, useful for testing or
// for self-hosters who prefer an external cron over the built-in scheduler.
//
// #250 — routes through the same enqueue-then-lease-claim path the internal
// scheduled ticker uses (src/instrumentation.ts), rather than calling
// runExpirationCheck() directly the way this endpoint used to. That used to
// mean an external trigger and the built-in scheduler ran the check through
// two different code paths — this is now the one path both share, so a
// concurrent scheduled tick and an external trigger can't double-run it.
// A generous limit rather than the ticker's small per-tick batch: this
// request is the household's explicit "run it now", so it should actually
// drain whatever's queued instead of leaving the enqueued check for the
// next tick to pick up.
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Set CRON_SECRET to enable this endpoint" },
      { status: 404 },
    );
  }

  const provided = request.headers.get("x-cron-secret");
  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const job = await enqueueJobUnlessPending("REMINDER_CHECK");
  await runPendingJobs(50);

  const settled = await prisma.backgroundJob.findUnique({
    where: { id: job?.id ?? "" },
    select: { status: true, lastError: true },
  });
  return NextResponse.json({
    triggered: "REMINDER_CHECK",
    status: settled?.status ?? "ALREADY_PENDING",
    error: settled?.lastError ?? undefined,
  });
}
