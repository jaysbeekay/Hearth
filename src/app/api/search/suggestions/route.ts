import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { getDueContext } from "@/lib/appSettings";
import { getUserPreferences } from "@/lib/userPreferences";
import { currentTenancy, LIVE_TENANCY_AGREEMENTS } from "@/lib/dueRecords";
import {
  buildContractAttentionItems,
  buildTenancyAttentionItems,
  buildVehicleAttentionItems,
  buildWarrantyAttentionItems,
  groupAttentionItems,
} from "@/lib/needsAttention";
import { parseRecentParam, type RecentKind } from "@/lib/recentRecords";
import { attentionSuggestions, orderRecent, RECENT_KIND_LABELS } from "@/lib/searchSuggestions";
import type { SearchResult } from "@/app/api/search/route";

// #366 — what Search shows before anything is typed: the records this
// browser opened last (`?recent=kind:id,…`, kept locally) with their current
// titles, and the first few Due rows from the dashboard's Needs attention.
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const recent = parseRecentParam(request.nextUrl.searchParams.get("recent"));
  const enabled = await getEnabledModuleKeys();
  const idsOf = (kind: RecentKind) => recent.filter((r) => r.kind === kind).map((r) => r.id);
  const found = (kind: RecentKind, rows: { id: string; title: string }[]) =>
    rows.map(
      (row): SearchResult => ({
        id: row.id,
        title: row.title,
        subtitle: RECENT_KIND_LABELS.get(kind),
        href: hrefFor(kind, row.id),
        group: kind,
      }),
    );
  const none = Promise.resolve([] as SearchResult[]);

  const [due, prefs, recentGroups] = await Promise.all([
    getDueContext(),
    getUserPreferences(),
    Promise.all([
      idsOf("contract").length
        ? prisma.contract
            .findMany({ where: { id: { in: idsOf("contract") }, deletedAt: null }, select: { id: true, title: true } })
            .then((rows) => found("contract", rows))
        : none,
      idsOf("warranty").length
        ? prisma.product
            .findMany({ where: { id: { in: idsOf("warranty") }, deletedAt: null }, select: { id: true, description: true } })
            .then((rows) => found("warranty", rows.map((r) => ({ id: r.id, title: r.description }))))
        : none,
      enabled.has("VEHICLES") && idsOf("vehicle").length
        ? prisma.vehicle
            .findMany({ where: { id: { in: idsOf("vehicle") }, deletedAt: null }, select: { id: true, label: true } })
            .then((rows) => found("vehicle", rows.map((r) => ({ id: r.id, title: r.label }))))
        : none,
      enabled.has("HOME") && idsOf("property").length
        ? prisma.property
            .findMany({ where: { id: { in: idsOf("property") }, deletedAt: null }, select: { id: true, label: true } })
            .then((rows) => found("property", rows.map((r) => ({ id: r.id, title: r.label }))))
        : none,
      enabled.has("TRAVEL") && idsOf("trip").length
        ? prisma.trip
            .findMany({ where: { id: { in: idsOf("trip") }, deletedAt: null }, select: { id: true, title: true } })
            .then((rows) => found("trip", rows))
        : none,
      enabled.has("INVENTORY") && idsOf("inventory").length
        ? prisma.inventoryItem
            .findMany({ where: { id: { in: idsOf("inventory") }, deletedAt: null }, select: { id: true, label: true } })
            .then((rows) => found("inventory", rows.map((r) => ({ id: r.id, title: r.label }))))
        : none,
    ]),
  ]);

  // The same Due rows the dashboard leads with (src/lib/needsAttention.ts).
  const [contracts, products, vehicles, properties] = await Promise.all([
    prisma.contract.findMany({
      where: { deletedAt: null },
      include: { _count: { select: { documents: { where: { deletedAt: null } } } } },
    }),
    prisma.product.findMany({
      where: { deletedAt: null },
      include: { _count: { select: { documents: { where: { deletedAt: null } } } } },
    }),
    enabled.has("VEHICLES") ? prisma.vehicle.findMany({ where: { deletedAt: null, archivedAt: null } }) : [],
    enabled.has("HOME")
      ? prisma.property.findMany({
          where: { deletedAt: null, archivedAt: null, isRented: true },
          select: { id: true, label: true, isRented: true, archivedAt: true, rentalAgreements: LIVE_TENANCY_AGREEMENTS },
        })
      : [],
  ]);
  const tenancies = properties.flatMap((property) => {
    const tenancy = currentTenancy(property);
    return tenancy
      ? [
          {
            propertyId: property.id,
            propertyLabel: property.label,
            agreementId: tenancy.id,
            tenantName: tenancy.tenantName,
            leaseEnd: tenancy.leaseEnd,
            reminderDaysBefore: tenancy.reminderDaysBefore,
          },
        ]
      : [];
  });
  const attention = groupAttentionItems([
    ...buildContractAttentionItems(contracts, due),
    ...buildWarrantyAttentionItems(products, due),
    ...buildVehicleAttentionItems(vehicles, due),
    ...buildTenancyAttentionItems(tenancies, due),
  ]);

  return NextResponse.json(
    {
      recent: orderRecent(recent, recentGroups.flat()),
      attention: attentionSuggestions(attention.due, prefs),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function hrefFor(kind: RecentKind, id: string): string {
  switch (kind) {
    case "contract":
      return `/contracts/${id}`;
    case "warranty":
      return `/products/${id}`;
    case "vehicle":
      return `/vehicles/${id}`;
    case "property":
      return `/home/${id}`;
    case "trip":
      return `/travel/${id}`;
    case "inventory":
      return `/inventory/${id}`;
  }
}
