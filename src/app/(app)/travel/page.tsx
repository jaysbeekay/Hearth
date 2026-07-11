import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { getUserPreferences } from "@/lib/userPreferences";
import { TravelListClient } from "@/components/TravelListClient";

export default async function TravelPage() {
  await requireModuleEnabled("TRAVEL");

  const [trips, { dateFormat }] = await Promise.all([
    prisma.trip.findMany({
      include: { _count: { select: { segments: true } } },
      orderBy: { startDate: "desc" },
    }),
    getUserPreferences(),
  ]);

  return <TravelListClient trips={trips} dateFormat={dateFormat} />;
}
