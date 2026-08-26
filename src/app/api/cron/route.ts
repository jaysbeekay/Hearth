import { NextRequest, NextResponse } from "next/server";
import { runExpirationCheck } from "@/lib/notifications/scheduler";
import { runPendingJobs } from "@/lib/jobs/runner";

// Manual/external trigger for the expiration check, useful for testing or
// for self-hosters who prefer an external cron over the built-in scheduler.
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

  const result = await runExpirationCheck();
  await runPendingJobs();
  return NextResponse.json(result);
}
