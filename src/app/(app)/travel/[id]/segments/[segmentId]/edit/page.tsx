import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { updateTripSegment } from "@/lib/actions/trips";
import { TripSegmentForm } from "@/components/TripSegmentForm";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";
import { Card } from "@/components/ui/Card";
import { PageShell } from "@/components/ui/PageShell";

export default async function EditTripSegmentPage({
  params,
}: {
  params: Promise<{ id: string; segmentId: string }>;
}) {
  await requireModuleEnabled("TRAVEL");

  const { id, segmentId } = await params;
  redirectIfReadOnly(await auth(), `/travel/${id}`);
  const segment = await prisma.tripSegment.findUnique({
    where: { id: segmentId },
    include: { trip: { select: { title: true, deletedAt: true } } },
  });
  if (!segment || segment.deletedAt || segment.trip.deletedAt || segment.tripId !== id) notFound();

  const boundAction = updateTripSegment.bind(null, id, segmentId);

  return (
    <PageShell width="form">
      <BackLink href={`/travel/${id}`} label={segment.trip.title} />
      <div>
        <h1 className="text-2xl font-medium">Edit segment</h1>
        <p className="text-sm text-muted">{segment.title}</p>
      </div>
      <Card>
        <TripSegmentForm action={boundAction} segment={segment} />
      </Card>
    </PageShell>
  );
}
