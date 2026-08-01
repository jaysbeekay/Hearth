import { NextRequest, NextResponse } from "next/server";
import { vehicleSchema } from "@/lib/validation/vehicles";
import { prisma } from "@/lib/prisma";
import { isModuleEnabled } from "@/lib/modules/enablement";
import { deleteVehicleItemDir } from "@/lib/storage";
import {
  mapVehicle,
  mobileError,
  requireMobileUser,
} from "@/app/api/mobile/v1/_lib/mobileApi";

async function requireVehiclesEnabled() {
  return (await isModuleEnabled("VEHICLES"))
    ? null
    : mobileError("Vehicles module is disabled.", 403);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireMobileUser();
  if ("response" in auth) return auth.response;
  const moduleError = await requireVehiclesEnabled();
  if (moduleError) return moduleError;
  const { id } = await params;
  const row = await prisma.vehicle.findUnique({
    where: { id },
    include: { _count: { select: { items: true } } },
  });
  return row
    ? NextResponse.json(mapVehicle(row))
    : mobileError("Not found.", 404);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireMobileUser({ write: true });
  if ("response" in auth) return auth.response;
  const moduleError = await requireVehiclesEnabled();
  if (moduleError) return moduleError;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = vehicleSchema.safeParse(body);
  if (!parsed.success) {
    return mobileError(
      parsed.error.issues[0]?.message ?? "Invalid vehicle.",
      400,
    );
  }
  const existing = await prisma.vehicle.findUnique({ where: { id } });
  if (!existing) return mobileError("Not found.", 404);
  if (
    request.headers.get("if-match") &&
    request.headers.get("if-match") !== existing.updatedAt.toISOString()
  ) {
    return mobileError("This record has changed since it was opened.", 409);
  }
  const row = await prisma.vehicle.update({
    where: { id },
    data: parsed.data,
    include: { _count: { select: { items: true } } },
  });
  return NextResponse.json(mapVehicle(row));
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireMobileUser({ write: true });
  if ("response" in auth) return auth.response;
  const moduleError = await requireVehiclesEnabled();
  if (moduleError) return moduleError;
  const { id } = await params;
  const existing = await prisma.vehicle.findUnique({
    where: { id },
    include: { items: { select: { id: true } } },
  });
  if (!existing) return new NextResponse(null, { status: 204 });
  if (
    request.headers.get("if-match") &&
    request.headers.get("if-match") !== existing.updatedAt.toISOString()
  ) {
    return mobileError("This record has changed since it was opened.", 409);
  }
  for (const item of existing.items) {
    await deleteVehicleItemDir(item.id);
  }
  await prisma.vehicle.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
