import { NextRequest, NextResponse } from "next/server";
import { vehicleItemSchema } from "@/lib/validation/vehicles";
import { prisma } from "@/lib/prisma";
import { isModuleEnabled } from "@/lib/modules/enablement";
import { deleteVehicleItemDir } from "@/lib/storage";
import {
  mapVehicleItem,
  mobileError,
  requireMobileUser,
} from "@/app/api/mobile/v1/_lib/mobileApi";

async function requireVehiclesEnabled() {
  return (await isModuleEnabled("VEHICLES"))
    ? null
    : mobileError("Vehicles module is disabled.", 403);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const auth = await requireMobileUser({ write: true });
  if ("response" in auth) return auth.response;
  const moduleError = await requireVehiclesEnabled();
  if (moduleError) return moduleError;
  const { id, itemId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = vehicleItemSchema.safeParse(body);
  if (!parsed.success) {
    return mobileError(
      parsed.error.issues[0]?.message ?? "Invalid vehicle item.",
      400,
    );
  }
  const existing = await prisma.vehicleItem.findUnique({
    where: { id: itemId },
  });
  if (!existing || existing.vehicleId !== id)
    return mobileError("Vehicle item not found.", 404);
  if (
    request.headers.get("if-match") &&
    request.headers.get("if-match") !== existing.updatedAt.toISOString()
  ) {
    return mobileError("This record has changed since it was opened.", 409);
  }
  const row = await prisma.vehicleItem.update({
    where: { id: itemId },
    data: parsed.data,
    include: { _count: { select: { documents: true } } },
  });
  return NextResponse.json(mapVehicleItem(row));
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const auth = await requireMobileUser({ write: true });
  if ("response" in auth) return auth.response;
  const moduleError = await requireVehiclesEnabled();
  if (moduleError) return moduleError;
  const { id, itemId } = await params;
  const existing = await prisma.vehicleItem.findUnique({
    where: { id: itemId },
  });
  if (!existing || existing.vehicleId !== id)
    return new NextResponse(null, { status: 204 });
  if (
    request.headers.get("if-match") &&
    request.headers.get("if-match") !== existing.updatedAt.toISOString()
  ) {
    return mobileError("This record has changed since it was opened.", 409);
  }
  await prisma.vehicleItem.delete({ where: { id: itemId } });
  await deleteVehicleItemDir(itemId);
  return new NextResponse(null, { status: 204 });
}
