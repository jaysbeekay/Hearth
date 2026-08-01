import { NextRequest, NextResponse } from "next/server";
import { vehicleItemSchema } from "@/lib/validation/vehicles";
import { prisma } from "@/lib/prisma";
import { isModuleEnabled } from "@/lib/modules/enablement";
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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireMobileUser();
  if ("response" in auth) return auth.response;
  const moduleError = await requireVehiclesEnabled();
  if (moduleError) return moduleError;
  const { id } = await params;
  const vehicle = await prisma.vehicle.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!vehicle) return mobileError("Vehicle not found.", 404);
  const rows = await prisma.vehicleItem.findMany({
    where: { vehicleId: id },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { documents: true } } },
  });
  return NextResponse.json({
    items: rows.map(mapVehicleItem),
    nextCursor: null,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireMobileUser({ write: true });
  if ("response" in auth) return auth.response;
  const moduleError = await requireVehiclesEnabled();
  if (moduleError) return moduleError;
  const { id } = await params;
  const vehicle = await prisma.vehicle.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!vehicle) return mobileError("Vehicle not found.", 404);
  const body = await request.json().catch(() => null);
  const parsed = vehicleItemSchema.safeParse(body);
  if (!parsed.success) {
    return mobileError(
      parsed.error.issues[0]?.message ?? "Invalid vehicle item.",
      400,
    );
  }
  const row = await prisma.vehicleItem.create({
    data: { ...parsed.data, vehicleId: id },
    include: { _count: { select: { documents: true } } },
  });
  return NextResponse.json(mapVehicleItem(row), { status: 201 });
}
