import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { getUserPreferences } from "@/lib/userPreferences";
import { VehicleListClient } from "@/components/VehicleListClient";

export default async function VehiclesPage() {
  await requireModuleEnabled("VEHICLES");

  const [vehicles, { dateFormat }] = await Promise.all([
    prisma.vehicle.findMany({
      include: { _count: { select: { items: true } } },
      orderBy: { createdAt: "desc" },
    }),
    getUserPreferences(),
  ]);

  return <VehicleListClient vehicles={vehicles} dateFormat={dateFormat} />;
}
