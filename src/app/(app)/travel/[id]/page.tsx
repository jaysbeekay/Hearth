import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Trash2, Plus, Plane, BedDouble, Ticket } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { addDocumentAction } from "@/lib/actions/documents";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import {
  deleteTrip,
  deleteTripSegment,
  refreshFlightStatusAction,
  restoreTrip,
  restoreTripSegment,
} from "@/lib/actions/trips";
import { ConfirmForm } from "@/components/ConfirmForm";
import { DetailField as Detail } from "@/components/DetailField";
import { DetailOverflowMenu } from "@/components/DetailOverflowMenu";
import { DocumentUploadForm } from "@/components/DocumentUploadForm";
import { DocumentList } from "@/components/DocumentList";
import { getTrashedVersionLinks } from "@/lib/documents/trashedVersionLinks";
import { RecordMeta } from "@/components/RecordMeta";
import { TRIP_SEGMENT_TYPE_LABELS, formatCurrency, formatDate, formatTimestamp, formatDistance } from "@/lib/utils";
import { getUserPreferences } from "@/lib/userPreferences";
import { getHouseholdMemberCount } from "@/lib/household";
import { shouldAutoRefresh, FLIGHT_STATUS_LABELS, flightStatusTone, refreshFlightStatus } from "@/lib/integrations/flightStatus";
import { computeSegmentDistance } from "@/lib/integrations/flightDistance";
import { FlightRefreshForm } from "@/components/FlightRefreshForm";
import { auth } from "@/lib/auth";
import { canWrite as sessionCanWrite } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";
import { buttonClass } from "@/lib/buttonStyles";
import { Card, EmptyState, Pill } from "@/components/ui";
import { cardClass } from "@/lib/ui";

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
  const canWrite = sessionCanWrite(await auth());
  const [trip, { dateFormat, displayTimeZone, region }, memberCount] = await Promise.all([
    prisma.trip.findUnique({
      where: { id },
      include: {
        createdBy: true,
        updatedBy: true,
        segments: {
          where: { deletedAt: null },
          include: { documents: { where: { deletedAt: null }, orderBy: { uploadedAt: "desc" } } },
        },
      },
    }),
    getUserPreferences(),
    getHouseholdMemberCount(),
  ]);
  if (!trip || trip.deletedAt) notFound();

  const trashedLinks = await getTrashedVersionLinks(
    "TRIP_SEGMENT",
    trip.segments.map((s) => s.id),
  );
  const segments = [...trip.segments].sort((a, b) => {
    if (!a.startDate && !b.startDate) return 0;
    if (!a.startDate) return 1;
    if (!b.startDate) return -1;
    return a.startDate.getTime() - b.startDate.getTime();
  });

  // Auto-refresh stale flight status for segments in the tracking window.
  // #400 — that writes the segment, so a read-only viewer sees the status
  // as last refreshed instead.
  await Promise.all(
    segments
      .filter((s) => canWrite && shouldAutoRefresh(s))
      .map((s) => refreshFlightStatus(s.id)),
  );

  // #13 — unlike flight status, distance never goes stale once computed, so
  // this isn't gated by shouldAutoRefresh's near-departure window: any
  // flight segment with both airports known but no cached distance yet
  // (including past trips) gets one lookup attempt. #326 review: NOT
  // awaited — each AviationStack call carries a 10s timeout, and gating
  // first paint on N of them (one per uncomputed segment) is a real latency
  // risk this page shouldn't take on for a nice-to-have enrichment. The
  // computed distance shows up on the next view instead of this one; the
  // negative-cache TTL in flightDistance.ts keeps a background retry storm
  // from ever building up behind it. #400/#391 — it writes the segment, so,
  // like the status refresh, only a member who can write triggers it.
  const needsDistance = (s: (typeof segments)[number]) =>
    canWrite &&
    s.type === "FLIGHT" && s.distanceKm == null && Boolean(s.departureIata) && Boolean(s.arrivalIata);
  void Promise.all(segments.filter(needsDistance).map((s) => computeSegmentDistance(s.id))).catch(() => {});

  // Re-fetch segments if any were refreshed so we display current data
  const refreshedAny = segments.some((s) => shouldAutoRefresh(s));
  const displaySegments = refreshedAny
    ? await prisma.tripSegment
        .findMany({
          where: { tripId: id, deletedAt: null },
          include: { documents: { where: { deletedAt: null }, orderBy: { uploadedAt: "desc" } } },
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
        <BackLink href="/travel" label="Travel" />
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted">{trip.destination || "No destination set"}</p>
          <h1 className="text-2xl font-medium">{trip.title}</h1>
          <p className="text-muted">
            {trip.startDate || trip.endDate
              ? `${formatDate(trip.startDate, dateFormat)} – ${formatDate(trip.endDate, dateFormat)}`
              : "No dates set"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canWrite && (
            <>
              <Link
                href={`/travel/${trip.id}/edit`}
                className={buttonClass("secondary")}
              >
                <Pencil size={16} />
                Edit
              </Link>
              <DetailOverflowMenu>
                <ConfirmForm
                  action={deleteTrip.bind(null, trip.id)}
                  undo={{ action: restoreTrip.bind(null, trip.id), href: `/travel/${trip.id}` }}
                  confirmText="Move this trip to Trash? Its segments and documents are kept, and you can restore it within 30 days from Settings → Trash."
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-danger hover:bg-danger/10"
                  offline={{ entity: "trip", entityId: trip.id, label: `Delete trip: ${trip.title}` }}
                >
                  <Trash2 size={16} />
                  Delete
                </ConfirmForm>
              </DetailOverflowMenu>
            </>
          )}
        </div>
      </div>

      {trip.notes && (
        <Card>
          <h2 className="mb-2 font-medium">Notes</h2>
          <p className="whitespace-pre-wrap text-sm text-foreground">{trip.notes}</p>
        </Card>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Itinerary</h2>
          {canWrite && (
            <Link
              href={`/travel/${trip.id}/segments/new`}
              className={buttonClass("primary")}
            >
              <Plus size={16} />
              Add segment
            </Link>
          )}
        </div>

        {displaySegments.length === 0 ? (
          <EmptyState as="p">
            No segments yet. Add a flight, lodging, or activity to build the itinerary.
          </EmptyState>
        ) : (
          <div className="space-y-3">
            {displaySegments.map((segment) => {
              const Icon = SEGMENT_ICONS[segment.type] ?? Ticket;
              return (
                <Card
                  key={segment.id}
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
                          <p className="text-sm text-muted">{segment.provider}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {canWrite && (
                        <>
                          <Link
                            href={`/travel/${trip.id}/segments/${segment.id}/edit`}
                            className={buttonClass("secondary")}
                          >
                            <Pencil size={16} />
                            Edit
                          </Link>
                          <ConfirmForm
                            action={deleteTripSegment.bind(null, trip.id, segment.id)}
                            undo={{ action: restoreTripSegment.bind(null, segment.id) }}
                            offline={{
                              entity: "tripSegment",
                              entityId: segment.id,
                              parentId: trip.id,
                              label: `Delete segment: ${segment.title}`,
                            }}
                            confirmText={`Move "${segment.title}" to Trash? Its documents are kept, and you can restore it within 30 days from Settings → Trash.`}
                            className={buttonClass("secondary", { className: "text-danger" })}
                          >
                            <Trash2 size={16} />
                            Delete
                          </ConfirmForm>
                        </>
                      )}
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
                    {segment.type === "FLIGHT" && segment.distanceKm != null && (
                      <Detail label="Distance" value={formatDistance(segment.distanceKm)} />
                    )}
                  </dl>

                  {segment.type === "FLIGHT" && segment.flightStatus && (
                    <div className={cardClass("mt-4 space-y-3")}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Pill tone={flightStatusTone(segment.flightStatus)}>
                            {FLIGHT_STATUS_LABELS[segment.flightStatus] ?? segment.flightStatus}
                          </Pill>
                          {segment.flightStatusAt && (
                            <span className="text-xs text-muted">
                              Updated {formatTimestamp(segment.flightStatusAt, dateFormat, displayTimeZone)}
                            </span>
                          )}
                        </div>
                        {canWrite && (
                          <FlightRefreshForm
                            action={refreshFlightStatusAction.bind(null, segment.id, id)}
                          />
                        )}
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
                    <div className={cardClass("mt-4 flex items-center justify-between")}>
                      <p className="text-xs text-muted">No flight status data yet.</p>
                      {canWrite && (
                        <FlightRefreshForm
                          action={refreshFlightStatusAction.bind(null, segment.id, id)}
                        />
                      )}
                    </div>
                  )}

                  {segment.notes && (
                    <p className="mt-4 whitespace-pre-wrap text-sm text-foreground">
                      {segment.notes}
                    </p>
                  )}

                  <div className="mt-4 border-t border-border pt-4">
                    <h3 className="mb-2 text-sm font-medium">Documents</h3>
                    <DocumentList
                      kind="TRIP_SEGMENT"
                      ownerId={segment.id}
                      trashedLinks={trashedLinks.get(segment.id)}
                      documents={segment.documents}
                    />
                    {canWrite && (
                      <div className="mt-3">
                        <DocumentUploadForm action={addDocumentAction.bind(null, "TRIP_SEGMENT", segment.id)} />
                      </div>
                    )}
                  </div>
                </Card>
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
