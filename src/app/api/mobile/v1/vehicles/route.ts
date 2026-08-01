import { NextRequest, NextResponse } from "next/server";
import { vehicleSchema } from "@/lib/validation/vehicles";
import { prisma } from "@/lib/prisma";
import { isModuleEnabled } from "@/lib/modules/enablement";
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

export async function GET(request: NextRequest) {
  const auth = await requireMobileUser();
  if ("response" in auth) return auth.response;
  const moduleError = await requireVehiclesEnabled();
  if (moduleError) return moduleError;

  const search = request.nextUrl.searchParams.get("search")?.trim();
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
  const rows = await prisma.vehicle.findMany({
    where: search
      ? {
          OR: [
            { label: { contains: search } },
            { make: { contains: search } },
            { model: { contains: search } },
            { licensePlate: { contains: search } },
            { vin: { contains: search } },
            { notes: { contains: search } },
          ],
        }
      : undefined,
    orderBy: { updatedAt: "desc" },
    take: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 50,
    include: { _count: { select: { items: true } } },
  });

  return NextResponse.json({ items: rows.map(mapVehicle), nextCursor: null });
}

export async function POST(request: NextRequest) {
  const auth = await requireMobileUser({ write: true });
  if ("response" in auth) return auth.response;
  const moduleError = await requireVehiclesEnabled();
  if (moduleError) return moduleError;

  const body = await request.json().catch(() => null);
  const parsed = vehicleSchema.safeParse(body);
  if (!parsed.success) {
    return mobileError(
      parsed.error.issues[0]?.message ?? "Invalid vehicle.",
      400,
    );
  }

  const row = await prisma.vehicle.create({
    data: { ...parsed.data, createdById: auth.user.id },
    include: { _count: { select: { items: true } } },
  });
  return NextResponse.json(mapVehicle(row), { status: 201 });
}
