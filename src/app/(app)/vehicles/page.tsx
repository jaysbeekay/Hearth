import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { VehicleListClient } from "@/components/VehicleListClient";

export default async function VehiclesPage() {
  await requireModuleEnabled("VEHICLES");

  const vehicles = await prisma.vehicle.findMany({
    include: { _count: { select: { items: true } } },
    orderBy: { createdAt: "desc" },
  });

  return <VehicleListClient vehicles={vehicles} />;
}
