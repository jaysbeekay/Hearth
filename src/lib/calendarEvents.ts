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
}

function urgencyFor(date: Date): "overdue" | "soon" | "ok" {
  const days = daysUntil(date);
  if (days == null) return "ok";
  if (days < 0) return "overdue";
  if (days <= 30) return "soon";
  return "ok";
}

export async function getCalendarEvents(
  userId: string,
  enabledModules: Set<string>,
): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = [];

  const [contracts, products] = await Promise.all([
    prisma.contract.findMany({
      where: { createdById: userId, endDate: { not: null } },
      select: { id: true, title: true, provider: true, endDate: true },
    }),
    prisma.product.findMany({
      where: { createdById: userId, warrantyEndDate: { not: null } },
      select: { id: true, name: true, manufacturer: true, warrantyEndDate: true },
    }),
  ]);

  for (const c of contracts) {
    if (!c.endDate) continue;
    events.push({
      id: `contract-${c.id}`,
      date: c.endDate,
      title: c.title,
      subtitle: c.provider,
      href: `/contracts/${c.id}`,
      kind: "contract",
      urgency: urgencyFor(c.endDate),
    });
  }

  for (const p of products) {
    if (!p.warrantyEndDate) continue;
    events.push({
      id: `product-${p.id}`,
      date: p.warrantyEndDate,
      title: p.name,
      subtitle: p.manufacturer ?? undefined,
      href: `/products/${p.id}`,
      kind: "product",
      urgency: urgencyFor(p.warrantyEndDate),
    });
  }

  if (enabledModules.has("VEHICLES")) {
    const vehicles = await prisma.vehicle.findMany({
      where: { createdById: userId },
      include: { items: { where: { date: { not: null } }, select: { id: true, title: true, date: true, type: true, vehicleId: true } } },
    });
    for (const v of vehicles) {
      if (v.regoExpiry) {
        events.push({
          id: `rego-${v.id}`,
          date: v.regoExpiry,
          title: `${v.label} — Rego expires`,
          href: `/vehicles/${v.id}`,
          kind: "vehicleExpiry",
          urgency: urgencyFor(v.regoExpiry),
        });
      }
      if (v.insuranceExpiry) {
        events.push({
          id: `insurance-${v.id}`,
          date: v.insuranceExpiry,
          title: `${v.label} — Insurance expires`,
          href: `/vehicles/${v.id}`,
          kind: "vehicleExpiry",
          urgency: urgencyFor(v.insuranceExpiry),
        });
      }
      for (const item of v.items) {
        if (!item.date) continue;
        events.push({
          id: `vehicleitem-${item.id}`,
          date: item.date,
          title: item.title,
          subtitle: v.label,
          href: `/vehicles/${v.id}`,
          kind: "vehicleItem",
          urgency: urgencyFor(item.date),
        });
      }
    }
  }

  if (enabledModules.has("TRAVEL")) {
    const segments = await prisma.tripSegment.findMany({
      where: { trip: { createdById: userId }, startDate: { not: null } },
      include: { trip: { select: { id: true, title: true } } },
    });
    for (const s of segments) {
      if (!s.startDate) continue;
      events.push({
        id: `segment-${s.id}`,
        date: s.startDate,
        endDate: s.endDate ?? undefined,
        title: s.title,
        subtitle: s.trip.title,
        href: `/travel/${s.trip.id}`,
        kind: "trip",
        urgency: urgencyFor(s.startDate),
      });
    }
  }

  if (enabledModules.has("HOME")) {
    const homeItems = await prisma.homeItem.findMany({
      where: { property: { createdById: userId }, date: { not: null } },
      include: { property: { select: { id: true, label: true } } },
    });
    for (const item of homeItems) {
      if (!item.date) continue;
      events.push({
        id: `homeitem-${item.id}`,
        date: item.date,
        title: item.title,
        subtitle: item.property.label,
        href: `/home/${item.property.id}`,
        kind: "homeItem",
        urgency: urgencyFor(item.date),
      });
    }
  }

  return events.sort((a, b) => a.date.getTime() - b.date.getTime());
}
