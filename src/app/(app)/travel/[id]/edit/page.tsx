import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { updateTrip } from "@/lib/actions/trips";
import { TripForm } from "@/components/TripForm";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";
import { Card } from "@/components/ui/Card";
import { PageShell } from "@/components/ui/PageShell";

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
    <PageShell width="form">
      <BackLink href={`/travel/${trip.id}`} label={trip.title} />
      <div>
        <h1 className="text-2xl font-medium">Edit trip</h1>
        <p className="text-sm text-muted">{trip.title}</p>
      </div>
      <Card>
        <TripForm action={boundAction} trip={trip} />
      </Card>
    </PageShell>
  );
}
