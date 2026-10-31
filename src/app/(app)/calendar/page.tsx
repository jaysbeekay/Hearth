import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { calendarKindLabel, getCalendarEvents } from "@/lib/calendarEvents";
import { getDueContext } from "@/lib/appSettings";
import { addDays, type CalendarDay } from "@/lib/duePolicy";
import { formatDate } from "@/lib/utils";
import { longMonthName, shortMonthName } from "@/lib/dateParts";
import { getUserPreferences } from "@/lib/userPreferences";
import { ExpiryBadge } from "@/components/ExpiryBadge";
import { CalendarSubscribeButton } from "@/components/CalendarSubscribeButton";
import type { CalendarEvent } from "@/lib/calendarEvents";
import { cardClass, chipClass } from "@/lib/ui";
import { EmptyState, PageShell } from "@/components/ui";

export const metadata: Metadata = { title: "Upcoming" };

// #288 — horizon chips answering "what's coming up in the next N days".
// #402 — Upcoming runs from the household's today to today + horizon, with
// no history: anything Overdue is in Needs attention instead.
const HORIZONS = [30, 60, 90] as const;
const DEFAULT_HORIZON = 30;

// Month names are English whatever the Region, from the shared month table
// rather than the runtime's locale data (#422). Keys are "YYYY-MM".

/** "October 2026". */
function monthLabel(key: string) {
  return `${longMonthName(Number(key.slice(5, 7)))} ${key.slice(0, 4)}`;
}

/** "Oct", for a calendar day. */
function dayMonth(day: CalendarDay) {
  return shortMonthName(Number(day.slice(5, 7)));
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ horizon?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [enabledModules, { dateFormat }, { horizon: horizonParam }, user] = await Promise.all([
    getEnabledModuleKeys(),
    getUserPreferences(),
    searchParams,
    prisma.user.findUnique({ where: { id: session.user.id }, select: { icalTokenHash: true } }),
  ]);
  const parsedHorizon = Number(horizonParam);
  const horizon = HORIZONS.includes(parsedHorizon as (typeof HORIZONS)[number])
    ? parsedHorizon
    : DEFAULT_HORIZON;

  const due = await getDueContext();
  const events = await getCalendarEvents(enabledModules, due, addDays(due.today, horizon));

  // Group by year-month
  const grouped = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = event.date.slice(0, 7);
    const existing = grouped.get(key) ?? [];
    existing.push(event);
    grouped.set(key, existing);
  }

  const months = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <PageShell width="list">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-medium">Upcoming</h1>
          <p className="text-sm text-muted">
            What&apos;s coming up across contracts, warranties, vehicles, trips and properties, from
            today to the horizon you pick. Anything overdue is in Needs attention on the dashboard.
          </p>
        </div>
        <CalendarSubscribeButton hasToken={Boolean(user?.icalTokenHash)} appUrl={env.appUrl} />
      </div>

      <div className="flex flex-wrap gap-2">
        {HORIZONS.map((h) => (
          <Link
            key={h}
            href={`/calendar?horizon=${h}`}
            aria-pressed={horizon === h}
            className={chipClass(horizon === h)}
          >
            {h} days
          </Link>
        ))}
      </div>

      {months.length === 0 ? (
        <EmptyState as="p">
          Nothing coming up in the next {horizon} days.
        </EmptyState>
      ) : (
        months.map(([key, monthEvents]) => (
          <section key={key}>
            <h2 className="mb-3 font-medium">
              {monthLabel(key)}
            </h2>
            <div className="space-y-2">
              {monthEvents.map((event) => (
                <Link
                  key={event.id}
                  href={event.href}
                  className={cardClass("flex items-start gap-3 transition-colors hover:border-accent/50")}
                >
                  <div className="mt-0.5 w-10 shrink-0 text-center">
                    <p className="text-xs text-muted">
                      {dayMonth(event.date)}
                    </p>
                    <p className="text-base font-medium leading-none">{Number(event.date.slice(8, 10))}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{event.title}</p>
                    {event.subtitle && (
                      <p className="truncate text-sm text-muted">{event.subtitle}</p>
                    )}
                    {event.endDate && event.endDate !== event.date && (
                      <p className="text-xs text-muted">until {formatDate(event.endDate, dateFormat)}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className="text-xs text-muted">
                      {calendarKindLabel(event.kind)}
                    </span>
                    {event.entry && <ExpiryBadge entry={event.entry} />}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </PageShell>
  );
}
