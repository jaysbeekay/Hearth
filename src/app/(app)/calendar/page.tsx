import type { Metadata } from "next";
import Link from "next/link";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { getCalendarEvents } from "@/lib/calendarEvents";
import { formatDate } from "@/lib/utils";
import { getUserPreferences } from "@/lib/userPreferences";
import { ExpiryBadge } from "@/components/ExpiryBadge";
import type { CalendarEvent } from "@/lib/calendarEvents";

export const metadata: Metadata = { title: "Upcoming" };

const KIND_COLORS: Record<CalendarEvent["kind"], string> = {
  contract: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  product: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  trip: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  homeItem: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  vehicleExpiry: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  vehicleItem: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
};

const KIND_LABELS: Record<CalendarEvent["kind"], string> = {
  contract: "Contract",
  product: "Product",
  trip: "Travel",
  homeItem: "Property",
  vehicleExpiry: "Vehicle",
  vehicleItem: "Vehicle record",
};

// #288 — horizon chips answering "what's expiring in the next N days"
// directly, instead of only a fixed 30-day window. Already-overdue events
// always show regardless of horizon — they're not "upcoming" but hiding
// them behind a horizon filter would regress what the calendar already did.
const HORIZONS = [30, 60, 90] as const;
const DEFAULT_HORIZON = 30;

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string, region: string) {
  const [year, month] = key.split("-");
  const d = new Date(Number(year), Number(month) - 1, 1);
  return d.toLocaleDateString(region, { month: "long", year: "numeric" });
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ horizon?: string }>;
}) {
  const [enabledModules, { dateFormat, region }, { horizon: horizonParam }] = await Promise.all([
    getEnabledModuleKeys(),
    getUserPreferences(),
    searchParams,
  ]);
  const parsedHorizon = Number(horizonParam);
  const horizon = HORIZONS.includes(parsedHorizon as (typeof HORIZONS)[number])
    ? parsedHorizon
    : DEFAULT_HORIZON;

  const allEvents = await getCalendarEvents(enabledModules);
  const events = allEvents.filter(
    (e) => e.daysUntilDate == null || e.daysUntilDate < 0 || e.daysUntilDate <= horizon,
  );

  // Group by year-month
  const grouped = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = monthKey(event.date);
    const existing = grouped.get(key) ?? [];
    existing.push(event);
    grouped.set(key, existing);
  }

  const months = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Upcoming</h1>
        <p className="text-sm text-muted">
          Everything expiring or coming up across contracts, warranties, vehicles, trips, and
          property — pick a horizon to answer &quot;what&apos;s expiring in the next N days&quot;.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {HORIZONS.map((h) => (
          <Link
            key={h}
            href={`/calendar?horizon=${h}`}
            aria-pressed={horizon === h}
            className={`rounded-full border px-3 py-1 text-sm font-medium ${
              horizon === h
                ? "border-accent bg-accent/10 text-accent"
                : "border-border bg-surface text-muted hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            {h} days
          </Link>
        ))}
      </div>

      {months.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted">
          Nothing expiring or coming up within {horizon} days.
        </p>
      ) : (
        months.map(([key, monthEvents]) => (
          <section key={key}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">
              {monthLabel(key, region)}
            </h2>
            <div className="space-y-2">
              {monthEvents.map((event) => (
                <Link
                  key={event.id}
                  href={event.href}
                  className="flex items-start gap-3 rounded-lg border border-border bg-surface p-3 shadow-stripe transition hover:border-accent/50"
                >
                  <div className="mt-0.5 w-10 shrink-0 text-center">
                    <p className="text-xs text-muted">{event.date.toLocaleDateString(region, { month: "short" })}</p>
                    <p className="text-lg font-semibold leading-none">{event.date.getDate()}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{event.title}</p>
                    {event.subtitle && (
                      <p className="truncate text-sm text-muted">{event.subtitle}</p>
                    )}
                    {event.endDate && event.endDate.getTime() !== event.date.getTime() && (
                      <p className="text-xs text-muted">until {formatDate(event.endDate, dateFormat)}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${KIND_COLORS[event.kind]}`}>
                      {KIND_LABELS[event.kind]}
                    </span>
                    <ExpiryBadge days={event.daysUntilDate} />
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
