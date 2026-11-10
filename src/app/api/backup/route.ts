import { NextRequest, NextResponse } from "next/server";
import { runBackup } from "@/lib/backup/scheduler";
import { cronSecretMatches } from "@/lib/cronSecret";

// Manual/external trigger for an offsite backup, useful for testing or for
// self-hosters who prefer an external cron over the built-in scheduler.
// Reuses CRON_SECRET (same trust boundary as /api/cron) rather than adding a
// second secret to manage.
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Set CRON_SECRET to enable this endpoint" },
      { status: 404 },
    );
  }

  const provided = request.headers.get("x-cron-secret");
  if (!cronSecretMatches(provided, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runBackup();
  return NextResponse.json(result);
}
