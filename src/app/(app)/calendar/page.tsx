import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { getCalendarEvents } from "@/lib/calendarEvents";
import { formatDate } from "@/lib/utils";
import { getUserPreferences } from "@/lib/userPreferences";
import type { CalendarEvent } from "@/lib/calendarEvents";

export const metadata: Metadata = { title: "Calendar" };

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
  homeItem: "Home",
  vehicleExpiry: "Vehicle",
  vehicleItem: "Vehicle record",
};

const URGENCY_RING: Record<CalendarEvent["urgency"], string> = {
  overdue: "ring-1 ring-danger/60",
  soon: "ring-1 ring-amber-400/60",
  ok: "",
};

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string) {
  const [year, month] = key.split("-");
  const d = new Date(Number(year), Number(month) - 1, 1);
  return d.toLocaleDateString("en-AU", { month: "long", year: "numeric" });
}

export default async function CalendarPage() {
  const session = await auth();
  const [enabledModules, { dateFormat }] = await Promise.all([
    getEnabledModuleKeys(),
    getUserPreferences(),
  ]);
  const events = await getCalendarEvents(session!.user.id, enabledModules);

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
      <h1 className="text-2xl font-semibold">Calendar</h1>

      {months.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-foreground/60">
          No dated events yet. Add contracts, products, trips, or vehicle records to see them here.
        </p>
      ) : (
        months.map(([key, monthEvents]) => (
          <section key={key}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-foreground/50">
              {monthLabel(key)}
            </h2>
            <div className="space-y-2">
              {monthEvents.map((event) => (
                <Link
                  key={event.id}
                  href={event.href}
                  className={`flex items-start gap-3 rounded-lg border border-border bg-surface p-3 shadow-stripe transition hover:border-accent/50 ${URGENCY_RING[event.urgency]}`}
                >
                  <div className="mt-0.5 w-10 shrink-0 text-center">
                    <p className="text-xs text-muted">{event.date.toLocaleDateString("en-AU", { month: "short" })}</p>
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
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${KIND_COLORS[event.kind]}`}>
                    {KIND_LABELS[event.kind]}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
