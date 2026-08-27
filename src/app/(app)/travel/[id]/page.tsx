import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Trash2, Plus, Plane, BedDouble, Ticket } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { deleteTrip, deleteTripSegment, addSegmentDocument, refreshFlightStatusAction } from "@/lib/actions/trips";
import { ConfirmForm } from "@/components/ConfirmForm";
import { DetailField as Detail } from "@/components/DetailField";
import { DetailOverflowMenu } from "@/components/DetailOverflowMenu";
import { DocumentUploadForm } from "@/components/DocumentUploadForm";
import { TripSegmentDocumentList } from "@/components/TripSegmentDocumentList";
import { RecordMeta } from "@/components/RecordMeta";
import { TRIP_SEGMENT_TYPE_LABELS, formatCurrency, formatDate } from "@/lib/utils";
import { getUserPreferences } from "@/lib/userPreferences";
import { getHouseholdMemberCount } from "@/lib/household";
import { shouldAutoRefresh, FLIGHT_STATUS_LABELS, flightStatusColour, refreshFlightStatus } from "@/lib/integrations/flightStatus";
import { FlightRefreshForm } from "@/components/FlightRefreshForm";

const SEGMENT_ICONS: Record<string, LucideIcon> = {
  FLIGHT: Plane,
  LODGING: BedDouble,
  ACTIVITY: Ticket,
};

export default async function TripDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleEnabled("TRAVEL");

  const { id } = await params;
  const [trip, { dateFormat, region }, memberCount] = await Promise.all([
    prisma.trip.findUnique({
      where: { id },
      include: {
        createdBy: true,
        updatedBy: true,
        segments: { include: { documents: { orderBy: { uploadedAt: "desc" } } } },
      },
    }),
    getUserPreferences(),
    getHouseholdMemberCount(),
  ]);
  if (!trip || trip.deletedAt) notFound();

  const segments = [...trip.segments].sort((a, b) => {
    if (!a.startDate && !b.startDate) return 0;
    if (!a.startDate) return 1;
    if (!b.startDate) return -1;
    return a.startDate.getTime() - b.startDate.getTime();
  });

  // Auto-refresh stale flight status for segments in the tracking window
  await Promise.all(
    segments
      .filter((s) => shouldAutoRefresh(s))
      .map((s) => refreshFlightStatus(s.id)),
  );

  // Re-fetch segments if any were refreshed so we display current data
  const refreshedAny = segments.some((s) => shouldAutoRefresh(s));
  const displaySegments = refreshedAny
    ? await prisma.tripSegment
        .findMany({
          where: { tripId: id },
          include: { documents: { orderBy: { uploadedAt: "desc" } } },
          orderBy: { startDate: "asc" },
        })
        .then((rows) =>
          rows.sort((a, b) => {
            if (!a.startDate && !b.startDate) return 0;
            if (!a.startDate) return 1;
            if (!b.startDate) return -1;
            return a.startDate.getTime() - b.startDate.getTime();
          }),
        )
    : segments;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/travel" className="text-sm text-muted hover:text-foreground">
          ← Back to travel
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted">{trip.destination || "No destination set"}</p>
          <h1 className="text-2xl font-semibold">{trip.title}</h1>
          <p className="text-foreground/70">
            {trip.startDate || trip.endDate
              ? `${formatDate(trip.startDate, dateFormat)} – ${formatDate(trip.endDate, dateFormat)}`
              : "No dates set"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/travel/${trip.id}/edit`}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
          >
            <Pencil size={16} />
            Edit
          </Link>
          <DetailOverflowMenu>
            <ConfirmForm
              action={deleteTrip.bind(null, trip.id)}
              confirmText="Delete this trip and all its segments and documents? This cannot be undone."
              actionLabel="Delete trip"
              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-danger hover:bg-danger/10"
              offline={{ entity: "trip", entityId: trip.id, label: `Delete trip: ${trip.title}` }}
            >
              <Trash2 size={16} />
              Delete
            </ConfirmForm>
          </DetailOverflowMenu>
        </div>
      </div>

      {trip.notes && (
        <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
          <h2 className="mb-2 font-medium">Notes</h2>
          <p className="whitespace-pre-wrap text-sm text-foreground/80">{trip.notes}</p>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Itinerary</h2>
          <Link
            href={`/travel/${trip.id}/segments/new`}
            className="flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
          >
            <Plus size={16} />
            Add segment
          </Link>
        </div>

        {displaySegments.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted">
            No segments yet. Add a flight, lodging, or activity to build the itinerary.
          </p>
        ) : (
          <div className="space-y-3">
            {displaySegments.map((segment) => {
              const Icon = SEGMENT_ICONS[segment.type] ?? Ticket;
              return (
                <div
                  key={segment.id}
                  className="rounded-xl border border-border bg-surface p-4 md:p-6"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <Icon size={20} className="mt-0.5 shrink-0 text-muted" />
                      <div className="min-w-0">
                        <p className="text-sm text-muted">
                          {TRIP_SEGMENT_TYPE_LABELS[segment.type] ?? segment.type}
                        </p>
                        <p className="font-medium">{segment.title}</p>
                        {segment.provider && (
                          <p className="text-sm text-foreground/70">{segment.provider}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/travel/${trip.id}/segments/${segment.id}/edit`}
                        className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
                      >
                        <Pencil size={16} />
                        Edit
                      </Link>
                      <ConfirmForm
                        action={deleteTripSegment.bind(null, trip.id, segment.id)}
                        confirmText={`Delete "${segment.title}" and its documents?`}
                        actionLabel={`Delete "${segment.title}"`}
                        className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-danger hover:bg-danger/10"
                      >
                        <Trash2 size={16} />
                        Delete
                      </ConfirmForm>
                    </div>
                  </div>

                  <dl className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3">
                    <Detail label="Confirmation code" value={segment.confirmationCode ?? "—"} copyable />
                    <Detail label="Start" value={formatDate(segment.startDate, dateFormat)} />
                    <Detail label="End" value={formatDate(segment.endDate, dateFormat)} />
                    <Detail label="Location" value={segment.location ?? "—"} />
                    <Detail
                      label="Cost"
                      value={
                        segment.cost != null ? formatCurrency(segment.cost, segment.currency, undefined, region) : "—"
                      }
                    />
                    {segment.type === "FLIGHT" && segment.flightNumber && (
                      <Detail label="Flight" value={segment.flightNumber} copyable />
                    )}
                    {segment.type === "FLIGHT" &&
                      segment.departureIata &&
                      segment.arrivalIata && (
                        <Detail
                          label="Route"
                          value={`${segment.departureIata} → ${segment.arrivalIata}`}
                        />
                      )}
                  </dl>

                  {segment.type === "FLIGHT" && segment.flightStatus && (
                    <div className="mt-4 rounded-lg border border-border p-3 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${flightStatusColour(segment.flightStatus)}`}
                          >
                            {FLIGHT_STATUS_LABELS[segment.flightStatus] ?? segment.flightStatus}
                          </span>
                          {segment.flightStatusAt && (
                            <span className="text-xs text-muted">
                              Updated {formatDate(segment.flightStatusAt, dateFormat)}
                            </span>
                          )}
                        </div>
                        <FlightRefreshForm
                          action={refreshFlightStatusAction.bind(null, segment.id, id)}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        {segment.depTerminal && (
                          <FlightDetail label="Dep terminal" value={segment.depTerminal} />
                        )}
                        {segment.depGate && (
                          <FlightDetail label="Dep gate" value={segment.depGate} />
                        )}
                        {segment.arrTerminal && (
                          <FlightDetail label="Arr terminal" value={segment.arrTerminal} />
                        )}
                        {segment.arrGate && (
                          <FlightDetail label="Arr gate" value={segment.arrGate} />
                        )}
                        {segment.estimatedDep && (
                          <FlightDetail
                            label="Est. departure"
                            value={formatDateTime(segment.estimatedDep)}
                          />
                        )}
                        {segment.estimatedArr && (
                          <FlightDetail
                            label="Est. arrival"
                            value={formatDateTime(segment.estimatedArr)}
                          />
                        )}
                        {segment.actualDep && (
                          <FlightDetail
                            label="Actual departure"
                            value={formatDateTime(segment.actualDep)}
                          />
                        )}
                        {segment.actualArr && (
                          <FlightDetail
                            label="Actual arrival"
                            value={formatDateTime(segment.actualArr)}
                          />
                        )}
                      </div>
                    </div>
                  )}

                  {segment.type === "FLIGHT" && segment.flightNumber && !segment.flightStatus && (
                    <div className="mt-4 flex items-center justify-between rounded-lg border border-border p-3">
                      <p className="text-xs text-muted">No flight status data yet.</p>
                      <FlightRefreshForm
                        action={refreshFlightStatusAction.bind(null, segment.id, id)}
                      />
                    </div>
                  )}

                  {segment.notes && (
                    <p className="mt-4 whitespace-pre-wrap text-sm text-foreground/80">
                      {segment.notes}
                    </p>
                  )}

                  <div className="mt-4 border-t border-border pt-4">
                    <h3 className="mb-2 text-sm font-medium">Documents</h3>
                    <TripSegmentDocumentList
                      documents={segment.documents}
                      dateFormat={dateFormat}
                    />
                    <div className="mt-3">
                      <DocumentUploadForm action={addSegmentDocument.bind(null, segment.id)} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <RecordMeta
        createdByName={trip.createdBy.name}
        updatedByName={trip.updatedBy?.name}
        createdAt={trip.createdAt}
        updatedAt={trip.updatedAt}
        dateFormat={dateFormat}
        memberCount={memberCount}
      />
    </div>
  );
}

const FlightDetail = Detail;

function formatDateTime(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}
