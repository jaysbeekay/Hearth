import { NextRequest, NextResponse } from "next/server";
import { contractSchema } from "@/lib/validation/contract";
import { prisma } from "@/lib/prisma";
import {
  mapContract,
  mobileError,
  requireMobileUser,
} from "@/app/api/mobile/v1/_lib/mobileApi";

export async function GET(request: NextRequest) {
  const auth = await requireMobileUser();
  if ("response" in auth) return auth.response;

  const search = request.nextUrl.searchParams.get("search")?.trim();
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
  const rows = await prisma.contract.findMany({
    where: search
      ? {
          OR: [
            { title: { contains: search } },
            { provider: { contains: search } },
            { contractNumber: { contains: search } },
            { notes: { contains: search } },
          ],
        }
      : undefined,
    orderBy: { updatedAt: "desc" },
    take: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 50,
    include: { _count: { select: { documents: true } } },
  });

  return NextResponse.json({ items: rows.map(mapContract), nextCursor: null });
}

export async function POST(request: NextRequest) {
  const auth = await requireMobileUser({ write: true });
  if ("response" in auth) return auth.response;

  const body = await request.json().catch(() => null);
  const parsed = contractSchema.safeParse(body);
  if (!parsed.success) {
    return mobileError(
      parsed.error.issues[0]?.message ?? "Invalid contract.",
      400,
    );
  }

  const row = await prisma.contract.create({
    data: { ...parsed.data, createdById: auth.user.id },
    include: { _count: { select: { documents: true } } },
  });
  return NextResponse.json(mapContract(row), { status: 201 });
}
