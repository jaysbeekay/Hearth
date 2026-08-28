import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { getUserPreferences } from "@/lib/userPreferences";
import { TravelListClient } from "@/components/TravelListClient";
import { buildDistanceSummary } from "@/lib/integrations/flightDistance";

export default async function TravelPage() {
  await requireModuleEnabled("TRAVEL");

  const [trips, flightSegments, { dateFormat }, session] = await Promise.all([
    prisma.trip.findMany({
      where: { deletedAt: null },
      include: { _count: { select: { segments: true } } },
      orderBy: { startDate: "desc" },
    }),
    prisma.tripSegment.findMany({
      where: { type: "FLIGHT", trip: { deletedAt: null } },
      select: { startDate: true, distanceKm: true },
    }),
    getUserPreferences(),
    auth(),
  ]);

  return (
    <TravelListClient
      trips={trips}
      dateFormat={dateFormat}
      canWrite={session?.user.role !== "READONLY"}
      distanceSummary={buildDistanceSummary(flightSegments)}
    />
  );
}
