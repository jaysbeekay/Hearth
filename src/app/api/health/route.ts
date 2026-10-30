import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkHealth } from "@/lib/health";

// Public health check for managed hosts and uptime monitors (#477). Listed in
// PUBLIC_PATHS (src/lib/auth.config.ts) so it answers without a session.
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await checkHealth(() => prisma.$queryRaw`SELECT 1`);
  return NextResponse.json(result.body, {
    status: result.httpStatus,
    headers: { "cache-control": "no-store" },
  });
}
