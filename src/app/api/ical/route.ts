import { NextRequest, NextResponse } from "next/server";
import ical from "ical-generator";
import { prisma } from "@/lib/prisma";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { env } from "@/lib/env";
import { addDays, calendarDayOf, noticeApplies } from "@/lib/duePolicy";
import { dayStart } from "@/lib/listDue";
import { currentTenancy, LIVE_TENANCY_AGREEMENTS } from "@/lib/dueRecords";
import { hashToken } from "@/lib/crypto";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return new NextResponse("Missing token", { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { icalTokenHash: hashToken(token) },
  });
  if (!user) {
    return new NextResponse("Invalid token", { status: 401 });
  }

  // The token identifies which household member subscribed, for revocation —
  // it does not narrow what the feed contains. Hearth is household-wide, and a
  // calendar filtered to rows this user happened to create was silently
  // missing most of the household's renewals.

  const enabledModules = await getEnabledModuleKeys();
  const appUrl = env.appUrl ?? "http://localhost:3000";

  const calendar = ical({ name: "Hearth", timezone: "UTC" });

  // Contracts. A feed keeps past dates (calendar apps show history), but
  // Cancelled Contracts leave it, as they leave Upcoming (#384).
  const contracts = await prisma.contract.findMany({
    where: { endDate: { not: null }, deletedAt: null, status: { not: "CANCELLED" } },
    select: { id: true, title: true, provider: true, endDate: true, noticePeriodDays: true, renewalType: true },
  });
  for (const c of contracts) {
    const end = calendarDayOf(c.endDate);
    if (!end) continue;
    // #351 — the last day to give notice, alongside the end date, by the
    // Due policy's notice rule.
    if (noticeApplies(c)) {
      const cancelBy = dayStart(addDays(end, -(c.noticePeriodDays ?? 0)));
      calendar.createEvent({
        id: `contract-${c.id}-notice`,
        start: cancelBy,
        end: new Date(cancelBy.getTime() + 86_400_000),
        allDay: true,
        summary: `${c.title} (last day to give notice)`,
        description: c.provider,
        url: `${appUrl}/contracts/${c.id}`,
      });
    }
    // Only a manual-renewal Contract expires: a fixed-term one ends and an
    // auto-renewing one renews (GLOSSARY.md).
    const verb = c.renewalType === "AUTO_RENEW" ? "renews" : c.renewalType === "FIXED_TERM" ? "ends" : "expires";
    calendar.createEvent({
      id: `contract-${c.id}`,
      start: dayStart(end),
      end: new Date(dayStart(end).getTime() + 86_400_000),
      allDay: true,
      summary: `${c.title} (${verb})`,
      description: c.provider,
      url: `${appUrl}/contracts/${c.id}`,
    });
  }

  // Products
  const products = await prisma.product.findMany({
    where: { warrantyEndDate: { not: null }, deletedAt: null },
    select: { id: true, description: true, manufacturer: true, warrantyEndDate: true },
  });
  for (const p of products) {
    if (!p.warrantyEndDate) continue;
    calendar.createEvent({
      id: `product-${p.id}`,
      start: p.warrantyEndDate,
      end: new Date(p.warrantyEndDate.getTime() + 86_400_000),
      allDay: true,
      summary: `${p.description} warranty ends`,
      description: p.manufacturer ?? undefined,
      url: `${appUrl}/products/${p.id}`,
    });
  }

  // Vehicles (rego + insurance + next service)
  if (enabledModules.has("VEHICLES")) {
    const vehicles = await prisma.vehicle.findMany({
      where: { deletedAt: null, archivedAt: null },
      select: { id: true, label: true, regoExpiry: true, insuranceExpiry: true, nextServiceDue: true },
    });
    for (const v of vehicles) {
      if (v.regoExpiry) {
        calendar.createEvent({
          id: `vehicle-rego-${v.id}`,
          start: v.regoExpiry,
          end: new Date(v.regoExpiry.getTime() + 86_400_000),
          allDay: true,
          summary: `${v.label} rego expires`,
          url: `${appUrl}/vehicles/${v.id}`,
        });
      }
      if (v.insuranceExpiry) {
        calendar.createEvent({
          id: `vehicle-ins-${v.id}`,
          start: v.insuranceExpiry,
          end: new Date(v.insuranceExpiry.getTime() + 86_400_000),
          allDay: true,
          summary: `${v.label} insurance expires`,
          url: `${appUrl}/vehicles/${v.id}`,
        });
      }
      if (v.nextServiceDue) {
        calendar.createEvent({
          id: `vehicle-service-${v.id}`,
          start: v.nextServiceDue,
          end: new Date(v.nextServiceDue.getTime() + 86_400_000),
          allDay: true,
          summary: `${v.label} service due`,
          url: `${appUrl}/vehicles/${v.id}`,
        });
      }
    }
  }

  // Travel segments
  if (enabledModules.has("TRAVEL")) {
    const segments = await prisma.tripSegment.findMany({
      where: { startDate: { not: null }, deletedAt: null, trip: { deletedAt: null } },
      include: { trip: { select: { id: true, title: true } } },
    });
    for (const s of segments) {
      if (!s.startDate) continue;
      const end = s.endDate ?? new Date(s.startDate.getTime() + 86_400_000);
      calendar.createEvent({
        id: `segment-${s.id}`,
        start: s.startDate,
        end,
        summary: `${s.title} (${s.trip.title})`,
        url: `${appUrl}/travel/${s.trip.id}`,
      });
    }
  }

  // Home items
  if (enabledModules.has("HOME")) {
    const homeItems = await prisma.homeItem.findMany({
      where: { date: { not: null }, deletedAt: null, property: { deletedAt: null, archivedAt: null } },
      include: { property: { select: { id: true, label: true } } },
    });
    for (const item of homeItems) {
      if (!item.date) continue;
      calendar.createEvent({
        id: `homeitem-${item.id}`,
        start: item.date,
        end: new Date(item.date.getTime() + 86_400_000),
        allDay: true,
        summary: `${item.title} (${item.property.label})`,
        url: `${appUrl}/home/${item.property.id}`,
      });
    }

    // A Tenancy's lease end, as on Upcoming: only the current Tenancy of a
    // Property with rental tracking on (#384). The UID is the agreement's,
    // so moving the lease end updates the event instead of adding one.
    const rentedProperties = await prisma.property.findMany({
      where: { deletedAt: null, archivedAt: null, isRented: true },
      select: { id: true, label: true, isRented: true, rentalAgreements: LIVE_TENANCY_AGREEMENTS },
    });
    for (const property of rentedProperties) {
      const tenancy = currentTenancy(property);
      const leaseEnd = calendarDayOf(tenancy?.leaseEnd);
      if (!tenancy || !leaseEnd) continue;
      calendar.createEvent({
        id: `lease-${tenancy.id}`,
        start: dayStart(leaseEnd),
        end: new Date(dayStart(leaseEnd).getTime() + 86_400_000),
        allDay: true,
        summary: `${property.label} lease ends`,
        description: tenancy.tenantName ?? undefined,
        url: `${appUrl}/home/${property.id}/rental`,
      });
    }
  }

  return new NextResponse(calendar.toString(), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="hearth.ics"',
      // The URL carries a bearer token in its query string — the one shape
      // calendar clients universally support. Keep it out of shared caches
      // and out of any Referer header a fetched URL might generate.
      "Cache-Control": "no-store, private",
      "Referrer-Policy": "no-referrer",
    },
  });
}
