import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { updateTrip } from "@/lib/actions/trips";
import { TripForm } from "@/components/TripForm";

export default async function EditTripPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleEnabled("TRAVEL");

  const { id } = await params;
  const trip = await prisma.trip.findUnique({ where: { id } });
  if (!trip) notFound();

  const boundAction = updateTrip.bind(null, trip.id);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Edit trip</h1>
        <p className="text-sm text-muted">{trip.title}</p>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <TripForm action={boundAction} trip={trip} />
      </div>
    </div>
  );
}
