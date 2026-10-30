import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cachedHealth, probeDatabase } from "@/lib/health";

// Public health check for managed hosts and uptime monitors (#477). Listed in
// PUBLIC_PATHS (src/lib/auth.config.ts) so it answers without a session.
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await cachedHealth(() => probeDatabase(prisma));
  return NextResponse.json(result.body, {
    status: result.httpStatus,
    headers: { "cache-control": "no-store" },
  });
}
