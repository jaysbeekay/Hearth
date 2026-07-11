import Link from "next/link";
import type { TripModel } from "@/generated/prisma/models";
import { formatDate } from "@/lib/utils";

export function TripCard({
  trip,
  dateFormat,
}: {
  trip: TripModel & { _count?: { segments: number } };
  dateFormat?: string;
}) {
  return (
    <Link
      href={`/travel/${trip.id}`}
      className="block min-w-0 rounded-lg border border-border bg-surface p-4 shadow-stripe transition hover:border-accent/50"
    >
      <div className="min-w-0">
        <p className="truncate text-sm text-muted">{trip.destination || "No destination set"}</p>
        <p className="truncate font-medium">{trip.title}</p>
      </div>

      <div className="mt-3 flex items-center justify-between text-sm text-muted">
        <span>
          {trip.startDate || trip.endDate
            ? `${formatDate(trip.startDate, dateFormat)} – ${formatDate(trip.endDate, dateFormat)}`
            : "No dates set"}
        </span>
        {trip._count != null && (
          <span className="tabular-nums">
            {trip._count.segments} {trip._count.segments === 1 ? "segment" : "segments"}
          </span>
        )}
      </div>
    </Link>
  );
}
