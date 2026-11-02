import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { getUserPreferences } from "@/lib/userPreferences";
import { TravelListClient } from "@/components/TravelListClient";
import { getTravelDistanceSummary } from "@/lib/integrations/flightDistance";
import { canWrite as sessionCanWrite } from "@/lib/readOnly";
import { MODULE_REGISTRY } from "@/lib/modules/registry";

export const metadata: Metadata = { title: MODULE_REGISTRY.TRAVEL.label };

export default async function TravelPage() {
  await requireModuleEnabled("TRAVEL");

  const [trips, distanceSummary, { dateFormat }, session] = await Promise.all([
    prisma.trip.findMany({
      where: { deletedAt: null },
      include: { _count: { select: { segments: { where: { deletedAt: null } } } } },
      orderBy: { startDate: "desc" },
    }),
    getTravelDistanceSummary(),
    getUserPreferences(),
    auth(),
  ]);

  return (
    <TravelListClient
      trips={trips}
      dateFormat={dateFormat}
      canWrite={sessionCanWrite(session)}
      distanceSummary={distanceSummary}
    />
  );
}
