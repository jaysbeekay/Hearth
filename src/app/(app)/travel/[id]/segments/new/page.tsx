import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { addTripSegment } from "@/lib/actions/trips";
import { TripSegmentForm } from "@/components/TripSegmentForm";
import { getUserPreferences } from "@/lib/userPreferences";

export default async function NewTripSegmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleEnabled("TRAVEL");

  const { id } = await params;
  const [trip, { preferredCurrency }] = await Promise.all([
    prisma.trip.findUnique({ where: { id } }),
    getUserPreferences(),
  ]);
  if (!trip) notFound();

  const boundAction = addTripSegment.bind(null, trip.id);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Add a segment</h1>
        <p className="text-sm text-foreground/60">{trip.title}</p>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <TripSegmentForm action={boundAction} tripId={trip.id} defaultCurrency={preferredCurrency} />
      </div>
    </div>
  );
}
