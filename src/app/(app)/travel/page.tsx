import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { TravelListClient } from "@/components/TravelListClient";

export default async function TravelPage() {
  await requireModuleEnabled("TRAVEL");

  const trips = await prisma.trip.findMany({
    include: { _count: { select: { segments: true } } },
    orderBy: { startDate: "desc" },
  });

  return <TravelListClient trips={trips} />;
}
