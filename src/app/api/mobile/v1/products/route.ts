import { NextRequest, NextResponse } from "next/server";
import { productSchema } from "@/lib/validation/product";
import { prisma } from "@/lib/prisma";
import {
  mapProduct,
  mobileError,
  requireMobileUser,
} from "@/app/api/mobile/v1/_lib/mobileApi";

export async function GET(request: NextRequest) {
  const auth = await requireMobileUser();
  if ("response" in auth) return auth.response;

  const search = request.nextUrl.searchParams.get("search")?.trim();
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
  const rows = await prisma.product.findMany({
    where: search
      ? {
          OR: [
            { description: { contains: search } },
            { manufacturer: { contains: search } },
            { model: { contains: search } },
            { vendor: { contains: search } },
            { serialNumber: { contains: search } },
            { notes: { contains: search } },
          ],
        }
      : undefined,
    orderBy: { updatedAt: "desc" },
    take: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 50,
    include: { _count: { select: { documents: true } } },
  });

  return NextResponse.json({ items: rows.map(mapProduct), nextCursor: null });
}

export async function POST(request: NextRequest) {
  const auth = await requireMobileUser({ write: true });
  if ("response" in auth) return auth.response;

  const body = await request.json().catch(() => null);
  const parsed = productSchema.safeParse(body);
  if (!parsed.success) {
    return mobileError(
      parsed.error.issues[0]?.message ?? "Invalid product.",
      400,
    );
  }

  const row = await prisma.product.create({
    data: { ...parsed.data, createdById: auth.user.id },
    include: { _count: { select: { documents: true } } },
  });
  return NextResponse.json(mapProduct(row), { status: 201 });
}
