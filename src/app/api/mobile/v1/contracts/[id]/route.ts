import { NextRequest, NextResponse } from "next/server";
import { contractSchema } from "@/lib/validation/contract";
import { prisma } from "@/lib/prisma";
import { deleteContractDir } from "@/lib/storage";
import {
  mapContract,
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
  const row = await prisma.contract.findUnique({
    where: { id },
    include: { _count: { select: { documents: true } } },
  });
  return row
    ? NextResponse.json(mapContract(row))
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
  const parsed = contractSchema.safeParse(body);
  if (!parsed.success) {
    return mobileError(
      parsed.error.issues[0]?.message ?? "Invalid contract.",
      400,
    );
  }
  const existing = await prisma.contract.findUnique({ where: { id } });
  if (!existing) return mobileError("Not found.", 404);
  if (
    request.headers.get("if-match") &&
    request.headers.get("if-match") !== existing.updatedAt.toISOString()
  ) {
    return mobileError("This record has changed since it was opened.", 409);
  }
  const row = await prisma.contract.update({
    where: { id },
    data: parsed.data,
    include: { _count: { select: { documents: true } } },
  });
  return NextResponse.json(mapContract(row));
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireMobileUser({ write: true });
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const existing = await prisma.contract.findUnique({ where: { id } });
  if (!existing) return new NextResponse(null, { status: 204 });
  if (
    request.headers.get("if-match") &&
    request.headers.get("if-match") !== existing.updatedAt.toISOString()
  ) {
    return mobileError("This record has changed since it was opened.", 409);
  }
  await prisma.contract.delete({ where: { id } });
  await deleteContractDir(id);
  return new NextResponse(null, { status: 204 });
}
