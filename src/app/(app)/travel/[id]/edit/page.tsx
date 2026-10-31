import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { updateTrip } from "@/lib/actions/trips";
import { TripForm } from "@/components/TripForm";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";

export default async function EditTripPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleEnabled("TRAVEL");

  const { id } = await params;
  redirectIfReadOnly(await auth(), `/travel/${id}`);
  const trip = await prisma.trip.findUnique({ where: { id } });
  if (!trip || trip.deletedAt) notFound();

  const boundAction = updateTrip.bind(null, trip.id);

  return (
    <div className="max-w-3xl space-y-6">
      <BackLink href={`/travel/${trip.id}`} label={trip.title} />
      <div>
        <h1 className="text-2xl font-medium">Edit trip</h1>
        <p className="text-sm text-muted">{trip.title}</p>
      </div>
      <div className="rounded-lg border border-border bg-surface p-4 md:p-6">
        <TripForm action={boundAction} trip={trip} />
      </div>
    </div>
  );
}
