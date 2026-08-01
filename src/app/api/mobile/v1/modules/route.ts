import { NextRequest, NextResponse } from "next/server";
import {
  getModuleSettings,
  mobileError,
  parseModuleKey,
  requireMobileUser,
} from "@/app/api/mobile/v1/_lib/mobileApi";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const auth = await requireMobileUser();
  if ("response" in auth) return auth.response;
  return NextResponse.json({ items: await getModuleSettings() });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireMobileUser({ admin: true, write: true });
  if ("response" in auth) return auth.response;

  const body = await request.json().catch(() => null);
  const key = typeof body?.key === "string" ? parseModuleKey(body.key) : null;
  if (!key || typeof body?.enabled !== "boolean") {
    return mobileError("Expected { key, enabled }.", 400);
  }

  const row = await prisma.moduleEnablement.upsert({
    where: { key },
    update: { enabled: body.enabled },
    create: { key, enabled: body.enabled },
  });

  return NextResponse.json({
    key: row.key,
    enabled: row.enabled,
    updatedAt: row.updatedAt.toISOString(),
  });
}
