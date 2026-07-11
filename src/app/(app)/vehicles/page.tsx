import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { getUserPreferences } from "@/lib/userPreferences";
import { VehicleListClient } from "@/components/VehicleListClient";

export default async function VehiclesPage() {
  await requireModuleEnabled("VEHICLES");

  const [vehicles, { dateFormat }, session] = await Promise.all([
    prisma.vehicle.findMany({
      include: { _count: { select: { items: true } } },
      orderBy: { createdAt: "desc" },
    }),
    getUserPreferences(),
    auth(),
  ]);

  return (
    <VehicleListClient
      vehicles={vehicles}
      dateFormat={dateFormat}
      canWrite={session?.user.role !== "READONLY"}
    />
  );
}
