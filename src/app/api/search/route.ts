import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { formatPropertyAddress } from "@/lib/utils";
import { searchDocumentsFts, hitOwnerIds, hitDocIds, sortByHitRank } from "@/lib/documents/documentSearch";

export interface SearchResult {
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  group: string;
  // True when the query only matched text inside an attached document, not
  // any of the record's own fields — surfaced in the UI so a Contract and
  // one of its Documents both showing up for the same query reads as
  // intentional, not duplicated.
  matchedInDocument?: boolean;
}

const LIMIT = 8;

function matchedViaFields(q: string, fields: (string | null | undefined)[]) {
  const needle = q.toLowerCase();
  return fields.some((f) => f?.toLowerCase().includes(needle));
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";

  // #205 — memory-fragment filters. Scoped to Contract/Product, the two
  // record types with both an expiry date and the extraction-review/
  // document infrastructure these filters key off; other domains stay
  // text-search-only rather than growing bespoke "expiring"/"needsReview"
  // semantics for shapes that don't naturally have them.
  const FILTER_VALUES = ["expiring", "needsReview", "noDocument", "important", "missingDate", "missingReminder", "missingRelationship", "missingIdentifier"] as const;
  type SearchFilter = (typeof FILTER_VALUES)[number];
  const filterParam = request.nextUrl.searchParams.get("filter");
  const filter: SearchFilter | undefined = (FILTER_VALUES as readonly string[]).includes(
    filterParam ?? "",
  )
    ? (filterParam as SearchFilter)
    : undefined;

  const textOk = q.length >= 2;
  if (!textOk && !filter) {
    return NextResponse.json({ groups: {} }, { headers: { "Cache-Control": "no-store" } });
  }

  const now = new Date();
  const soon = new Date(now.getTime() + 30 * 86_400_000);

  const enabledModules = await getEnabledModuleKeys();
  const contains = { contains: q };
  const queries: Promise<SearchResult[]>[] = [];

  // #314 — one ranked, indexed FTS5 query across all 9 document tables'
  // filename/extracted-text content, replacing the per-table `contains`
  // scans this file used to run. Each per-kind block below resolves its
  // hits' docIds through that kind's own Prisma delegate (applying the same
  // owner-liveness filters as before) and re-sorts back into FTS rank order,
  // since that resolution step can drop hits and doesn't preserve rank.
  const ftsHits = textOk ? await searchDocumentsFts(q, { limit: 60 }) : [];

  queries.push(
    prisma.contract
      .findMany({
        where: {
          deletedAt: null,
          AND: [
            ...(textOk
              ? [
                  {
                    OR: [
                      { title: contains },
                      { provider: contains },
                      { contractNumber: contains },
                      { id: { in: hitOwnerIds(ftsHits, "CONTRACT") } },
                    ],
                  },
                ]
              : []),
            ...(filter === "expiring" ? [{ status: "ACTIVE" as const, endDate: { gte: now, lte: soon } }] : []),
            ...(filter === "needsReview" ? [{ extractionPending: true }] : []),
            ...(filter === "noDocument" ? [{ documents: { none: {} } }] : []),
            ...(filter === "important" ? [{ documents: { some: { isImportant: true } } }] : []),
            ...(filter === "missingDate" ? [{ endDate: null }] : []),
            ...(filter === "missingReminder" ? [{ reminderDaysBefore: null }] : []),
            ...(filter === "missingRelationship" ? [{ propertyId: null, vehicleId: null }] : []),
            ...(filter === "missingIdentifier" ? [{ contractNumber: null }] : []),
          ],
        },
        select: { id: true, title: true, provider: true, contractNumber: true },
        take: LIMIT,
      })
      .then((rows) =>
        rows.map((r) => ({
          id: r.id,
          title: r.title,
          subtitle:
            textOk && matchedViaFields(q, [r.contractNumber]) && !matchedViaFields(q, [r.title, r.provider])
              ? [r.provider, `№ ${r.contractNumber}`].filter(Boolean).join(" · ")
              : r.provider,
          href: `/contracts/${r.id}`,
          group: "Contracts",
          matchedInDocument: textOk ? !matchedViaFields(q, [r.title, r.provider, r.contractNumber]) : false,
        })),
      ),
  );

  queries.push(
    prisma.product
      .findMany({
        where: {
          deletedAt: null,
          AND: [
            ...(textOk
              ? [
                  {
                    OR: [
                      { description: contains },
                      { manufacturer: contains },
                      { model: contains },
                      { vendor: contains },
                      { serialNumber: contains },
                      { barcode: contains },
                      { id: { in: hitOwnerIds(ftsHits, "PRODUCT") } },
                    ],
                  },
                ]
              : []),
            ...(filter === "expiring" ? [{ warrantyEndDate: { gte: now, lte: soon } }] : []),
            ...(filter === "needsReview" ? [{ extractionPending: true }] : []),
            ...(filter === "noDocument" ? [{ documents: { none: {} } }] : []),
            ...(filter === "important" ? [{ documents: { some: { isImportant: true } } }] : []),
            ...(filter === "missingDate" ? [{ warrantyEndDate: null }] : []),
            ...(filter === "missingReminder" ? [{ reminderDaysBefore: null }] : []),
            ...(filter === "missingRelationship" ? [{ propertyId: null }] : []),
            ...(filter === "missingIdentifier" ? [{ OR: [{ serialNumber: null }, { barcode: null }] }] : []),
          ],
        },
        select: {
          id: true,
          description: true,
          manufacturer: true,
          vendor: true,
          serialNumber: true,
          barcode: true,
        },
        take: LIMIT,
      })
      .then((rows) =>
        rows.map((r) => ({
          id: r.id,
          title: r.description,
          subtitle:
            textOk &&
            matchedViaFields(q, [r.serialNumber, r.barcode]) &&
            !matchedViaFields(q, [r.description, r.manufacturer, r.vendor])
              ? [r.manufacturer, `# ${r.serialNumber ?? r.barcode}`].filter(Boolean).join(" · ")
              : (r.manufacturer ?? undefined),
          href: `/products/${r.id}`,
          group: "Products",
          matchedInDocument: textOk
            ? !matchedViaFields(q, [r.description, r.manufacturer, r.vendor, r.serialNumber, r.barcode])
            : false,
        })),
      ),
  );

  if (textOk) {
    const contractDocIds = hitDocIds(ftsHits, "CONTRACT");
    if (contractDocIds.length > 0) {
      queries.push(
        prisma.document
          .findMany({
            where: { id: { in: contractDocIds }, contract: { deletedAt: null } },
            select: { id: true, filename: true, contract: { select: { id: true, title: true } } },
          })
          .then((rows) =>
            sortByHitRank(rows, ftsHits)
              .slice(0, LIMIT)
              .map((r) => ({
                id: r.id,
                title: r.filename,
                subtitle: r.contract.title,
                href: `/contracts/${r.contract.id}`,
                group: "Documents",
              })),
          ),
      );
    }

    const productDocIds = hitDocIds(ftsHits, "PRODUCT");
    if (productDocIds.length > 0) {
      queries.push(
        prisma.productDocument
          .findMany({
            where: { id: { in: productDocIds }, product: { deletedAt: null } },
            select: { id: true, filename: true, product: { select: { id: true, description: true } } },
          })
          .then((rows) =>
            sortByHitRank(rows, ftsHits)
              .slice(0, LIMIT)
              .map((r) => ({
                id: r.id,
                title: r.filename,
                subtitle: r.product.description,
                href: `/products/${r.product.id}`,
                group: "Documents",
              })),
          ),
      );
    }
  }

  if (enabledModules.has("VEHICLES") && textOk) {
    queries.push(
      prisma.vehicle
        .findMany({
          where: {
            deletedAt: null,
            OR: [
              { label: contains },
              { make: contains },
              { model: contains },
              { licensePlate: contains },
              { vin: contains },
            ],
          },
          select: { id: true, label: true, make: true, model: true, licensePlate: true, vin: true },
          take: LIMIT,
        })
        .then((rows) =>
          rows.map((r) => ({
            id: r.id,
            title: r.label,
            subtitle:
              matchedViaFields(q, [r.vin, r.licensePlate]) && !matchedViaFields(q, [r.make, r.model])
                ? [[r.make, r.model].filter(Boolean).join(" "), r.licensePlate ?? r.vin]
                    .filter(Boolean)
                    .join(" · ")
                : [r.make, r.model].filter(Boolean).join(" ") || undefined,
            href: `/vehicles/${r.id}`,
            group: "Vehicles",
          })),
        ),
    );

    const vehicleItemDocIds = hitDocIds(ftsHits, "VEHICLE_ITEM");
    if (vehicleItemDocIds.length > 0) {
      queries.push(
        prisma.vehicleItemDocument
          .findMany({
            where: { id: { in: vehicleItemDocIds }, vehicleItem: { vehicle: { deletedAt: null } } },
            select: {
              id: true,
              filename: true,
              vehicleItem: { select: { vehicleId: true, vehicle: { select: { label: true } } } },
            },
          })
          .then((rows) =>
            sortByHitRank(rows, ftsHits)
              .slice(0, LIMIT)
              .map((r) => ({
                id: r.id,
                title: r.filename,
                subtitle: r.vehicleItem.vehicle.label,
                href: `/vehicles/${r.vehicleItem.vehicleId}`,
                group: "Documents",
              })),
          ),
      );
    }
  }

  if (enabledModules.has("TRAVEL") && textOk) {
    queries.push(
      prisma.trip
        .findMany({
          where: { deletedAt: null, OR: [{ title: contains }, { destination: contains }] },
          select: { id: true, title: true, destination: true },
          take: LIMIT,
        })
        .then((rows) =>
          rows.map((r) => ({
            id: r.id,
            title: r.title,
            subtitle: r.destination ?? undefined,
            href: `/travel/${r.id}`,
            group: "Travel",
          })),
        ),
    );

    queries.push(
      prisma.tripSegment
        .findMany({
          where: { confirmationCode: contains, trip: { deletedAt: null } },
          select: { id: true, title: true, confirmationCode: true, tripId: true, trip: { select: { title: true } } },
          take: LIMIT,
        })
        .then((rows) =>
          rows.map((r) => ({
            id: r.id,
            title: r.title,
            subtitle: [r.trip.title, `Conf. ${r.confirmationCode}`].filter(Boolean).join(" · "),
            href: `/travel/${r.tripId}`,
            group: "Travel",
          })),
        ),
    );

    const tripSegmentDocIds = hitDocIds(ftsHits, "TRIP_SEGMENT");
    if (tripSegmentDocIds.length > 0) {
      queries.push(
        prisma.tripSegmentDocument
          .findMany({
            where: { id: { in: tripSegmentDocIds }, tripSegment: { trip: { deletedAt: null } } },
            select: {
              id: true,
              filename: true,
              tripSegment: { select: { tripId: true, trip: { select: { title: true } } } },
            },
          })
          .then((rows) =>
            sortByHitRank(rows, ftsHits)
              .slice(0, LIMIT)
              .map((r) => ({
                id: r.id,
                title: r.filename,
                subtitle: r.tripSegment.trip.title,
                href: `/travel/${r.tripSegment.tripId}`,
                group: "Documents",
              })),
          ),
      );
    }
  }

  if (enabledModules.has("HOME") && textOk) {
    queries.push(
      prisma.property
        .findMany({
          where: {
            deletedAt: null,
            OR: [
              { label: contains },
              { street: contains },
              { suburb: contains },
              { state: contains },
              { postcode: contains },
              { country: contains },
            ],
          },
          select: {
            id: true,
            label: true,
            street: true,
            suburb: true,
            state: true,
            postcode: true,
            country: true,
          },
          take: LIMIT,
        })
        .then((rows) =>
          rows.map((r) => ({
            id: r.id,
            title: r.label,
            subtitle: formatPropertyAddress(r) || undefined,
            href: `/home/${r.id}`,
            group: "Property",
          })),
        ),
    );

    queries.push(
      prisma.homeItem
        .findMany({
          where: { OR: [{ title: contains }, { provider: contains }], property: { deletedAt: null } },
          select: {
            id: true,
            title: true,
            propertyId: true,
            property: { select: { label: true } },
          },
          take: LIMIT,
        })
        .then((rows) =>
          rows.map((r) => ({
            id: r.id,
            title: r.title,
            subtitle: r.property.label,
            href: `/home/${r.propertyId}/items/${r.id}`,
            group: "Property",
          })),
        ),
    );

    const homeItemDocIds = hitDocIds(ftsHits, "HOME_ITEM");
    if (homeItemDocIds.length > 0) {
      queries.push(
        prisma.homeItemDocument
          .findMany({
            where: { id: { in: homeItemDocIds }, homeItem: { property: { deletedAt: null } } },
            select: {
              id: true,
              filename: true,
              homeItem: { select: { id: true, propertyId: true, title: true } },
            },
          })
          .then((rows) =>
            sortByHitRank(rows, ftsHits)
              .slice(0, LIMIT)
              .map((r) => ({
                id: r.id,
                title: r.filename,
                subtitle: r.homeItem.title,
                href: `/home/${r.homeItem.propertyId}/items/${r.homeItem.id}`,
                group: "Documents",
              })),
          ),
      );
    }

    // #314 — rental statements had zero search coverage before this change.
    const rentalStatementDocIds = hitDocIds(ftsHits, "RENTAL_STATEMENT");
    if (rentalStatementDocIds.length > 0) {
      queries.push(
        prisma.rentalStatementDocument
          .findMany({
            where: { id: { in: rentalStatementDocIds }, rentalStatement: { property: { deletedAt: null } } },
            select: {
              id: true,
              filename: true,
              rentalStatement: {
                select: { id: true, propertyId: true, property: { select: { label: true } } },
              },
            },
          })
          .then((rows) =>
            sortByHitRank(rows, ftsHits)
              .slice(0, LIMIT)
              .map((r) => ({
                id: r.id,
                title: r.filename,
                subtitle: r.rentalStatement.property.label,
                href: `/home/${r.rentalStatement.propertyId}/rental/statements/${r.rentalStatement.id}`,
                group: "Documents",
              })),
          ),
      );
    }
  }

  if (enabledModules.has("INVENTORY") && textOk) {
    queries.push(
      prisma.inventoryItem
        .findMany({
          where: { deletedAt: null, OR: [{ label: contains }, { brand: contains }, { model: contains }] },
          select: { id: true, label: true, brand: true },
          take: LIMIT,
        })
        .then((rows) =>
          rows.map((r) => ({
            id: r.id,
            title: r.label,
            subtitle: r.brand ?? undefined,
            href: `/inventory/${r.id}`,
            group: "Inventory",
          })),
        ),
    );

    const inventoryItemDocIds = hitDocIds(ftsHits, "INVENTORY_ITEM");
    if (inventoryItemDocIds.length > 0) {
      queries.push(
        prisma.inventoryItemDocument
          .findMany({
            where: { id: { in: inventoryItemDocIds }, inventoryItem: { deletedAt: null } },
            select: { id: true, filename: true, inventoryItem: { select: { id: true, label: true } } },
          })
          .then((rows) =>
            sortByHitRank(rows, ftsHits)
              .slice(0, LIMIT)
              .map((r) => ({
                id: r.id,
                title: r.filename,
                subtitle: r.inventoryItem.label,
                href: `/inventory/${r.inventoryItem.id}`,
                group: "Documents",
              })),
          ),
      );
    }
  }

  if (enabledModules.has("WEALTH") && textOk) {
    queries.push(
      prisma.portfolio
        .findMany({
          where: { name: contains },
          select: { id: true, name: true },
          take: LIMIT,
        })
        .then((rows) =>
          rows.map((r) => ({
            id: r.id,
            title: r.name,
            href: `/wealth/portfolios/${r.id}`,
            group: "Wealth",
          })),
        ),
    );

    // #314 — trade documents had zero search coverage before this change.
    // Portfolio/Holding/Trade have no deletedAt column, so no liveness
    // filter is needed here — a hard-deleted Trade already cascades its
    // TradeDocument rows away, which the fts_trade_documents_ad trigger
    // already keeps in sync.
    const tradeDocIds = hitDocIds(ftsHits, "TRADE");
    if (tradeDocIds.length > 0) {
      queries.push(
        prisma.tradeDocument
          .findMany({
            where: { id: { in: tradeDocIds } },
            select: {
              id: true,
              filename: true,
              trade: {
                select: { id: true, holding: { select: { id: true, portfolioId: true, ticker: true } } },
              },
            },
          })
          .then((rows) =>
            sortByHitRank(rows, ftsHits)
              .slice(0, LIMIT)
              .map((r) => ({
                id: r.id,
                title: r.filename,
                subtitle: r.trade.holding.ticker,
                href: `/wealth/portfolios/${r.trade.holding.portfolioId}/holdings/${r.trade.holding.id}/trades/${r.trade.id}`,
                group: "Documents",
              })),
          ),
      );
    }
  }

  // #199 — an unfiled document is still findable by name/content, so a
  // household member who half-remembers uploading something isn't limited
  // to browsing the Documents inbox tab to rediscover it.
  if (textOk) {
    const inboxDocIds = hitDocIds(ftsHits, "INBOX");
    if (inboxDocIds.length > 0) {
      queries.push(
        prisma.inboxDocument
          .findMany({
            where: { id: { in: inboxDocIds } },
            select: { id: true, filename: true },
          })
          .then((rows) =>
            sortByHitRank(rows, ftsHits)
              .slice(0, LIMIT)
              .map((r) => ({
                id: r.id,
                title: r.filename,
                href: "/documents/inbox",
                group: "Inbox",
                matchedInDocument: !matchedViaFields(q, [r.filename]),
              })),
          ),
      );
    }
  }

  const results = (await Promise.all(queries)).flat();
  const groups: Record<string, SearchResult[]> = {};
  for (const r of results) {
    (groups[r.group] ??= []).push(r);
  }

  return NextResponse.json({ groups }, { headers: { "Cache-Control": "no-store" } });
}
