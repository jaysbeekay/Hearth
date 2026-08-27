import { prisma } from "@/lib/prisma";
import { daysUntil } from "@/lib/utils";

export interface CalendarEvent {
  id: string;
  date: Date;
  endDate?: Date;
  title: string;
  subtitle?: string;
  href: string;
  kind: "contract" | "product" | "trip" | "homeItem" | "vehicleExpiry" | "vehicleItem";
  urgency: "overdue" | "soon" | "ok";
  // #288 — the raw day count backing `urgency`, so the page can render a
  // text label (ExpiryBadge's "Expired 10d ago" / "12d left") instead of
  // urgency being conveyed by the row's ring colour alone (WCAG 1.4.1).
  daysUntilDate: number | null;
}

function urgencyFor(days: number | null): "overdue" | "soon" | "ok" {
  if (days == null) return "ok";
  if (days < 0) return "overdue";
  if (days <= 30) return "soon";
  return "ok";
}

// Household-wide: the calendar shows everything the household tracks, not
// just the rows the viewing user happened to create. Filtering these by
// `createdById` gave each member a different, silently incomplete calendar.
export async function getCalendarEvents(
  enabledModules: Set<string>,
): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = [];

  const [contracts, products] = await Promise.all([
    prisma.contract.findMany({
      where: { endDate: { not: null }, deletedAt: null },
      select: { id: true, title: true, provider: true, endDate: true },
    }),
    prisma.product.findMany({
      where: { warrantyEndDate: { not: null }, deletedAt: null },
      select: { id: true, description: true, manufacturer: true, warrantyEndDate: true },
    }),
  ]);

  for (const c of contracts) {
    if (!c.endDate) continue;
    const days = daysUntil(c.endDate);
    events.push({
      id: `contract-${c.id}`,
      date: c.endDate,
      title: c.title,
      subtitle: c.provider,
      href: `/contracts/${c.id}`,
      kind: "contract",
      urgency: urgencyFor(days),
      daysUntilDate: days,
    });
  }

  for (const p of products) {
    if (!p.warrantyEndDate) continue;
    const days = daysUntil(p.warrantyEndDate);
    events.push({
      id: `product-${p.id}`,
      date: p.warrantyEndDate,
      title: p.description,
      subtitle: p.manufacturer ?? undefined,
      href: `/products/${p.id}`,
      kind: "product",
      urgency: urgencyFor(days),
      daysUntilDate: days,
    });
  }

  if (enabledModules.has("VEHICLES")) {
    const vehicles = await prisma.vehicle.findMany({
      where: { deletedAt: null },
      include: { items: { where: { date: { not: null } }, select: { id: true, title: true, date: true, type: true, vehicleId: true } } },
    });
    for (const v of vehicles) {
      if (v.regoExpiry) {
        const days = daysUntil(v.regoExpiry);
        events.push({
          id: `rego-${v.id}`,
          date: v.regoExpiry,
          title: `${v.label} — Rego expires`,
          href: `/vehicles/${v.id}`,
          kind: "vehicleExpiry",
          urgency: urgencyFor(days),
          daysUntilDate: days,
        });
      }
      if (v.insuranceExpiry) {
        const days = daysUntil(v.insuranceExpiry);
        events.push({
          id: `insurance-${v.id}`,
          date: v.insuranceExpiry,
          title: `${v.label} — Insurance expires`,
          href: `/vehicles/${v.id}`,
          kind: "vehicleExpiry",
          urgency: urgencyFor(days),
          daysUntilDate: days,
        });
      }
      for (const item of v.items) {
        if (!item.date) continue;
        const days = daysUntil(item.date);
        events.push({
          id: `vehicleitem-${item.id}`,
          date: item.date,
          title: item.title,
          subtitle: v.label,
          href: `/vehicles/${v.id}`,
          kind: "vehicleItem",
          urgency: urgencyFor(days),
          daysUntilDate: days,
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
      if (!s.startDate) continue;
      const days = daysUntil(s.startDate);
      events.push({
        id: `segment-${s.id}`,
        date: s.startDate,
        endDate: s.endDate ?? undefined,
        title: s.title,
        subtitle: s.trip.title,
        href: `/travel/${s.trip.id}`,
        kind: "trip",
        urgency: urgencyFor(days),
        daysUntilDate: days,
      });
    }
  }

  if (enabledModules.has("HOME")) {
    const homeItems = await prisma.homeItem.findMany({
      where: { date: { not: null }, property: { deletedAt: null } },
      include: { property: { select: { id: true, label: true } } },
    });
    for (const item of homeItems) {
      if (!item.date) continue;
      const days = daysUntil(item.date);
      events.push({
        id: `homeitem-${item.id}`,
        date: item.date,
        title: item.title,
        subtitle: item.property.label,
        href: `/home/${item.property.id}`,
        kind: "homeItem",
        urgency: urgencyFor(days),
        daysUntilDate: days,
      });
    }
  }

  return events.sort((a, b) => a.date.getTime() - b.date.getTime());
}
