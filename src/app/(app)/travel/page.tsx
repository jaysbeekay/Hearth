import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { getUserPreferences } from "@/lib/userPreferences";
import { TravelListClient } from "@/components/TravelListClient";

export default async function TravelPage() {
  await requireModuleEnabled("TRAVEL");

  const [trips, { dateFormat }, session] = await Promise.all([
    prisma.trip.findMany({
      include: { _count: { select: { segments: true } } },
      orderBy: { startDate: "desc" },
    }),
    getUserPreferences(),
    auth(),
  ]);

  return (
    <TravelListClient
      trips={trips}
      dateFormat={dateFormat}
      canWrite={session?.user.role !== "READONLY"}
    />
  );
}
