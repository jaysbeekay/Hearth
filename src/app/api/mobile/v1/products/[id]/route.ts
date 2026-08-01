import { NextRequest, NextResponse } from "next/server";
import { productSchema } from "@/lib/validation/product";
import { prisma } from "@/lib/prisma";
import { deleteProductDir } from "@/lib/storage";
import {
  mapProduct,
  mobileError,
  requireMobileUser,
} from "@/app/api/mobile/v1/_lib/mobileApi";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireMobileUser();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const row = await prisma.product.findUnique({
    where: { id },
    include: { _count: { select: { documents: true } } },
  });
  return row
    ? NextResponse.json(mapProduct(row))
    : mobileError("Not found.", 404);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireMobileUser({ write: true });
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = productSchema.safeParse(body);
  if (!parsed.success) {
    return mobileError(
      parsed.error.issues[0]?.message ?? "Invalid product.",
      400,
    );
  }
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) return mobileError("Not found.", 404);
  if (
    request.headers.get("if-match") &&
    request.headers.get("if-match") !== existing.updatedAt.toISOString()
  ) {
    return mobileError("This record has changed since it was opened.", 409);
  }
  const row = await prisma.product.update({
    where: { id },
    data: parsed.data,
    include: { _count: { select: { documents: true } } },
  });
  return NextResponse.json(mapProduct(row));
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireMobileUser({ write: true });
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) return new NextResponse(null, { status: 204 });
  if (
    request.headers.get("if-match") &&
    request.headers.get("if-match") !== existing.updatedAt.toISOString()
  ) {
    return mobileError("This record has changed since it was opened.", 409);
  }
  await prisma.product.delete({ where: { id } });
  await deleteProductDir(id);
  return new NextResponse(null, { status: 204 });
}
