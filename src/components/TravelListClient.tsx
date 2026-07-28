"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { linkButtonClass, toolbarButtonClass, exportMenuItemClass } from "@/lib/buttonStyles";
import { Plus, ChevronDown } from "lucide-react";
import { TripCard } from "@/components/TripCard";
import { PendingRecordCard } from "@/components/PendingRecordCard";
import type { TripModel } from "@/generated/prisma/models";
import { cachePageData } from "@/lib/offlineCache";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { usePendingCreates } from "@/lib/usePendingCreates";

type TripWithCount = TripModel & { _count: { segments: number } };

interface Props {
  trips: TripWithCount[];
  dateFormat?: string;
  canWrite?: boolean;
}

export function TravelListClient({ trips, dateFormat, canWrite = true }: Props) {
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Travel</h1>
        <div className="flex items-center gap-2">
          <details className="relative">
            <summary className={toolbarButtonClass}>
              Export <ChevronDown size={14} />
            </summary>
            <div className="absolute right-0 z-10 mt-1 w-28 overflow-hidden rounded-lg border border-border bg-surface shadow-md">
              <a href="/api/export/travel?format=csv" download className={exportMenuItemClass}>CSV</a>
              <a href="/api/export/travel?format=pdf" download className={exportMenuItemClass}>PDF</a>
            </div>
          </details>
          {canWrite && (
            <Link
              href="/travel/new"
              aria-disabled={!online}
              tabIndex={!online ? -1 : undefined}
              className={linkButtonClass("primary", { online })}
            >
              <Plus size={16} />
              Add trip
            </Link>
          )}
        </div>
      </div>

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
          <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-foreground/60">
            No trips yet. Add your first trip to start building an itinerary.
          </p>
        )
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {trips.map((trip) => (
            <TripCard key={trip.id} trip={trip} dateFormat={dateFormat} />
          ))}
        </div>
      )}
    </div>
  );
}
