import { prisma } from "@/lib/prisma";
import { calendarDayOf, type CalendarDay, type DueContext, type DueEntry } from "@/lib/duePolicy";
import { contractDue, currentTenancy, tenancyDue, TENANCY_AGREEMENT_SELECT, vehicleDue, warrantyDue } from "@/lib/dueRecords";
import { dayStart } from "@/lib/listDue";

export type CalendarKind =
  | "contract"
  | "warranty"
  | "vehicle"
  | "serviceRecord"
  | "trip"
  | "maintenanceRecord"
  | "tenancy";

export interface CalendarEvent {
  id: string;
  date: CalendarDay;
  endDate?: CalendarDay;
  title: string;
  subtitle?: string;
  href: string;
  kind: CalendarKind;
  /**
   * #384 — the Due entry behind the event, whose state and label its badge
   * shows. Absent for Trips and for Service and Maintenance records, which
   * are never Due (records of finished work have no state, #402).
   */
  entry?: DueEntry;
}

/** The record-type tag Upcoming shows, in the glossary's nouns. */
export function calendarKindLabel(kind: CalendarKind): string {
  switch (kind) {
    case "contract":
      return "Contract";
    case "warranty":
      return "Warranty";
    case "vehicle":
      return "Vehicle";
    case "serviceRecord":
      return "Service record";
    case "trip":
      return "Trip";
    case "maintenanceRecord":
      return "Maintenance record";
    case "tenancy":
      return "Tenancy";
  }
}

// The date's name only: the badge beside it says what's happening ("Rego
// due 8 Nov"), from the Due policy.
const VEHICLE_TITLES = new Map<string, string>([
  ["regoExpiry", "Rego"],
  ["insuranceExpiry", "Insurance"],
  ["nextServiceDue", "Service"],
]);

/**
 * Upcoming (#402): the household's dated things from `ctx.today` to
 * `until`, inclusive. No history: anything Overdue is in Needs attention
 * instead, and a Trip shows while any of it is still ahead.
 *
 * Household-wide: Upcoming shows everything the household tracks, not just
 * the rows the viewing user happened to create. Filtering these by
 * `createdById` gave each member a different, silently incomplete calendar.
 */
export async function getCalendarEvents(
  enabledModules: Set<string>,
  ctx: DueContext,
  until: CalendarDay,
): Promise<CalendarEvent[]> {
  const from = ctx.today;
  const inRange = (day: CalendarDay | null): day is CalendarDay => day != null && day >= from && day <= until;
  // Rough narrowing only; the day checks below decide (ADR 0002).
  const fromDate = dayStart(from);
  const events: CalendarEvent[] = [];

  const [contracts, products] = await Promise.all([
    prisma.contract.findMany({
      // Cancelled Contracts have no Due entries and leave Upcoming.
      where: { deletedAt: null, status: { not: "CANCELLED" }, endDate: { gte: fromDate } },
      select: {
        id: true,
        title: true,
        provider: true,
        endDate: true,
        noticePeriodDays: true,
        renewalType: true,
        status: true,
        reminderDaysBefore: true,
      },
    }),
    prisma.product.findMany({
      where: { deletedAt: null, warrantyEndDate: { gte: fromDate } },
      select: { id: true, description: true, manufacturer: true, warrantyEndDate: true, reminderDaysBefore: true },
    }),
  ]);

  for (const c of contracts) {
    const href = `/contracts/${c.id}`;
    const entries = contractDue(c, ctx);
    for (const entry of entries) {
      if (!inRange(entry.date)) continue;
      events.push({
        id: entry.field === "noticeDeadline" ? `contract-${c.id}-notice` : `contract-${c.id}`,
        date: entry.date,
        title: c.title,
        subtitle: `${entry.field === "noticeDeadline" ? "Last day to give notice" : "End date"} · ${c.provider}`,
        href,
        kind: "contract",
        entry,
      });
    }
    // While the notice deadline is ahead it is the Contract's Due entry, but
    // its end date is still on the timeline, so it shows without a badge.
    const end = calendarDayOf(c.endDate);
    if (entries.every((e) => e.field !== "endDate") && inRange(end)) {
      events.push({ id: `contract-${c.id}`, date: end, title: c.title, subtitle: `End date · ${c.provider}`, href, kind: "contract" });
    }
  }

  for (const p of products) {
    for (const entry of warrantyDue(p, ctx)) {
      if (!inRange(entry.date)) continue;
      events.push({
        id: `product-${p.id}`,
        date: entry.date,
        title: p.description,
        subtitle: p.manufacturer ?? undefined,
        href: `/products/${p.id}`,
        kind: "warranty",
        entry,
      });
    }
  }

  if (enabledModules.has("VEHICLES")) {
    const vehicles = await prisma.vehicle.findMany({
      where: { deletedAt: null },
      include: {
        items: { where: { deletedAt: null, date: { gte: fromDate } }, select: { id: true, title: true, date: true } },
      },
    });
    for (const v of vehicles) {
      for (const entry of vehicleDue(v, ctx)) {
        if (!inRange(entry.date)) continue;
        events.push({
          id: `${entry.field}-${v.id}`,
          date: entry.date,
          title: `${v.label} — ${VEHICLE_TITLES.get(entry.field) ?? entry.field}`,
          href: `/vehicles/${v.id}`,
          kind: "vehicle",
          entry,
        });
      }
      for (const item of v.items) {
        const day = calendarDayOf(item.date);
        if (!inRange(day)) continue;
        events.push({
          id: `vehicleitem-${item.id}`,
          date: day,
          title: item.title,
          subtitle: v.label,
          href: `/vehicles/${v.id}`,
          kind: "serviceRecord",
        });
      }
    }
  }

  if (enabledModules.has("TRAVEL")) {
    const segments = await prisma.tripSegment.findMany({
      where: { startDate: { not: null }, trip: { deletedAt: null } },
      include: { trip: { select: { id: true, title: true } } },
    });
    for (const s of segments) {
      const start = calendarDayOf(s.startDate);
      const end = calendarDayOf(s.endDate) ?? start;
      // A Trip segment shows while any of it is still ahead: a stay that
      // began last week and ends tomorrow is upcoming, one that ended isn't.
      if (!start || !end || start > until || end < from) continue;
      events.push({
        id: `segment-${s.id}`,
        date: start < from ? from : start,
        endDate: end,
        title: s.title,
        subtitle: s.trip.title,
        href: `/travel/${s.trip.id}`,
        kind: "trip",
      });
    }
  }

  if (enabledModules.has("HOME")) {
    const [homeItems, properties] = await Promise.all([
      prisma.homeItem.findMany({
        where: { deletedAt: null, date: { gte: fromDate }, property: { deletedAt: null } },
        include: { property: { select: { id: true, label: true } } },
      }),
      prisma.property.findMany({
        where: { deletedAt: null, isRented: true },
        select: {
          id: true,
          label: true,
          isRented: true,
          rentalAgreements: { select: TENANCY_AGREEMENT_SELECT },
        },
      }),
    ]);
    for (const item of homeItems) {
      const day = calendarDayOf(item.date);
      if (!inRange(day)) continue;
      events.push({
        id: `homeitem-${item.id}`,
        date: day,
        title: item.title,
        subtitle: item.property.label,
        href: `/home/${item.property.id}`,
        kind: "maintenanceRecord",
      });
    }
    for (const property of properties) {
      const tenancy = currentTenancy(property);
      if (!tenancy) continue;
      for (const entry of tenancyDue(tenancy, ctx)) {
        if (!inRange(entry.date)) continue;
        events.push({
          id: `lease-${tenancy.id}`,
          date: entry.date,
          title: `${property.label} — Lease end`,
          subtitle: tenancy.tenantName ?? undefined,
          href: `/home/${property.id}/rental`,
          kind: "tenancy",
          entry,
        });
      }
    }
  }

  return events.sort((a, b) => a.date.localeCompare(b.date));
}
