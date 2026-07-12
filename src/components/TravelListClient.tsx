"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Plus, ChevronDown } from "lucide-react";
import { TripCard } from "@/components/TripCard";
import type { TripModel } from "@/generated/prisma/models";
import { cachePageData } from "@/lib/offlineCache";
import { useOnlineStatus } from "@/lib/useOnlineStatus";

type TripWithCount = TripModel & { _count: { segments: number } };

interface Props {
  trips: TripWithCount[];
  dateFormat?: string;
  canWrite?: boolean;
}

export function TravelListClient({ trips, dateFormat, canWrite = true }: Props) {
  const online = useOnlineStatus();

  useEffect(() => {
    cachePageData("trips:list", trips).catch(() => {});
  }, [trips]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Travel</h1>
        <div className="flex items-center gap-2">
          <details className="relative">
            <summary className="flex cursor-pointer list-none items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5">
              Export <ChevronDown size={14} />
            </summary>
            <div className="absolute right-0 z-10 mt-1 w-28 overflow-hidden rounded-lg border border-border bg-surface shadow-md">
              <a href="/api/export/travel?format=csv" download className="block px-4 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5">CSV</a>
              <a href="/api/export/travel?format=pdf" download className="block px-4 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5">PDF</a>
            </div>
          </details>
          {canWrite && (
            <Link
              href="/travel/new"
              aria-disabled={!online}
              tabIndex={!online ? -1 : undefined}
              className={`flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90${!online ? " pointer-events-none opacity-40" : ""}`}
            >
              <Plus size={16} />
              Add trip
            </Link>
          )}
        </div>
      </div>

      {trips.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-foreground/60">
          No trips yet. Add your first trip to start building an itinerary.
        </p>
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
