import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { updateTripSegment } from "@/lib/actions/trips";
import { TripSegmentForm } from "@/components/TripSegmentForm";

export default async function EditTripSegmentPage({
  params,
}: {
  params: Promise<{ id: string; segmentId: string }>;
}) {
  await requireModuleEnabled("TRAVEL");

  const { id, segmentId } = await params;
  const segment = await prisma.tripSegment.findUnique({ where: { id: segmentId } });
  if (!segment || segment.tripId !== id) notFound();

  const boundAction = updateTripSegment.bind(null, id, segmentId);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Edit segment</h1>
        <p className="text-sm text-muted">{segment.title}</p>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <TripSegmentForm action={boundAction} segment={segment} />
      </div>
    </div>
  );
}
