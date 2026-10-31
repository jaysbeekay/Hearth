import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { getUserPreferences } from "@/lib/userPreferences";
import { getDueContext } from "@/lib/appSettings";
import { VehicleListClient } from "@/components/VehicleListClient";
import { parseListFilters, vehicleFilterWheres, vehicleRules } from "@/lib/recordFilters";
import { canWrite as sessionCanWrite } from "@/lib/readOnly";
import { MODULE_REGISTRY } from "@/lib/modules/registry";

export const metadata: Metadata = { title: MODULE_REGISTRY.VEHICLES.label };

export default async function VehiclesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModuleEnabled("VEHICLES");

  // #395 — Vehicles only have the Missing key details filter.
  const { missingDetails } = parseListFilters(await searchParams);
  const filters = { missingDetails };

  const vehicleCounts = {
    _count: { select: { items: true, contracts: { where: { deletedAt: null } } } },
  };
  const [vehicles, archivedVehicles, missingDetailsCount, { dateFormat }, session, due] = await Promise.all([
    prisma.vehicle.findMany({
      where: { deletedAt: null, archivedAt: null, AND: vehicleFilterWheres(filters) },
      include: vehicleCounts,
      orderBy: { createdAt: "desc" },
    }),
    // #355 — Archived Vehicles (sold) stay on their own list below the rest.
    prisma.vehicle.findMany({
      where: { deletedAt: null, archivedAt: { not: null } },
      include: vehicleCounts,
      orderBy: { archivedAt: "desc" },
    }),
    prisma.vehicle.count({ where: vehicleRules.missingDetails.where }),
    getUserPreferences(),
    auth(),
    getDueContext(),
  ]);

  return (
    <VehicleListClient
      vehicles={vehicles}
      archivedVehicles={archivedVehicles}
      filters={filters}
      counts={{ missingDetails: missingDetailsCount }}
      due={due}
      dateFormat={dateFormat}
      canWrite={sessionCanWrite(session)}
    />
  );
}
