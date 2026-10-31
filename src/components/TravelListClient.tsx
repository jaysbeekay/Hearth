"use client";

import { useEffect } from "react";
import { ListPageHeader } from "@/components/ListPageHeader";
import { useRouter } from "next/navigation";
import { Route } from "lucide-react";
import { TripCard } from "@/components/TripCard";
import { PendingRecordCard } from "@/components/PendingRecordCard";
import type { TripModel } from "@/generated/prisma/models";
import { cachePageData } from "@/lib/offlineCache";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { usePendingCreates } from "@/lib/usePendingCreates";
import { formatDistance } from "@/lib/utils";
import type { DistanceSummary } from "@/lib/integrations/flightDistance";
import { MODULE_REGISTRY } from "@/lib/modules/registry";
import { Card, EmptyState, PageShell } from "@/components/ui";

type TripWithCount = TripModel & { _count: { segments: number } };

interface Props {
  trips: TripWithCount[];
  dateFormat?: string;
  canWrite?: boolean;
  distanceSummary?: DistanceSummary;
}

export function TravelListClient({ trips, dateFormat, canWrite = true, distanceSummary }: Props) {
  const online = useOnlineStatus();
  const router = useRouter();
  const { pendingOps, refresh: refreshPending } = usePendingCreates("trip");

  useEffect(() => {
    cachePageData("trips:list", trips).catch(() => {});
  }, [trips]);

  useEffect(() => {
    const onSyncComplete = () => router.refresh();
    window.addEventListener("offline-sync-complete", onSyncComplete);
    return () => window.removeEventListener("offline-sync-complete", onSyncComplete);
  }, [router]);

  return (
    <PageShell width="list">
      <ListPageHeader
        title={MODULE_REGISTRY.TRAVEL.label}
        exportPath="/api/export/travel"
        action={canWrite ? { href: "/travel/new", label: "Add trip", online } : undefined}
      />

      {distanceSummary && distanceSummary.totalKm > 0 && (
        <Card>
          <div className="flex items-center gap-2">
            <Route size={16} className="text-muted" />
            <h2 className="font-medium">Distance travelled</h2>
          </div>
          <p className="mt-2 text-2xl font-medium">
            {formatDistance(distanceSummary.totalKm)}
          </p>
          {distanceSummary.byYear.length > 1 && (
            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
              {distanceSummary.byYear.map(({ year, km }) => (
                <div key={year} className="flex items-baseline gap-1.5">
                  <dt className="text-xs text-muted">{year}</dt>
                  <dd className="text-sm">{formatDistance(km)}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="mt-2 text-xs text-muted">
            Computed from flight segments with a known route — configure AviationStack (Settings → Household &amp; System → System
            settings) to auto-fill distances for new flights.
          </p>
        </Card>
      )}

      {pendingOps.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {pendingOps.map((op) => (
            <PendingRecordCard
              key={op.id}
              op={op}
              title={op.formValues?.title || "Untitled trip"}
              subtitle={op.formValues?.destination}
              editHref={`/travel/new?pendingOpId=${op.id}`}
              onDeleted={refreshPending}
            />
          ))}
        </div>
      )}

      {trips.length === 0 ? (
        pendingOps.length === 0 && (
          <EmptyState as="p">
            No trips yet. Add your first trip to start building an itinerary.
          </EmptyState>
        )
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {trips.map((trip) => (
            <TripCard key={trip.id} trip={trip} dateFormat={dateFormat} />
          ))}
        </div>
      )}
    </PageShell>
  );
}
