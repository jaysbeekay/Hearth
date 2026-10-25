import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { formatPropertyAddress } from "@/lib/utils";
import { searchDocumentsFts, hitOwnerIds, hitDocIds, sortByHitRank } from "@/lib/documents/documentSearch";
import {
  contractFilterWheres,
  contractMissingParts,
  CONTRACT_MISSING_SELECT,
  hasListFilters,
  inventoryMissingParts,
  inventoryRules,
  parseSearchFilters,
  productFilterWheres,
  productMissingParts,
  PRODUCT_MISSING_SELECT,
  vehicleFilterWheres,
  vehicleMissingParts,
  VEHICLE_MISSING_SELECT,
} from "@/lib/recordFilters";
import {
  CONTRACT_DUE_SELECT,
  VEHICLE_DUE_SELECT,
  WARRANTY_DUE_SELECT,
  contractDueFilter,
  vehicleDueFilter,
  warrantyDueFilter,
} from "@/lib/listDue";
import { getDueContext } from "@/lib/appSettings";

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

// #395 — under Missing key details each row says which part is missing
// ("No end date"), from the same rule that selected it.
function missingSubtitle(parts: string[]): string | undefined {
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

// #332/#362 — the nav said "Policies & contracts" / "Purchases &
// warranties" for a while and now says "Contracts" / "Warranties" again.
// A query consisting of just one of those generic category words, old or
// new, finds every record of that type, not only ones whose
// title/provider/description happens to literally contain the word —
// matching what a user typing that word almost certainly means.
const CONTRACT_ALIASES = new Set(["contract", "contracts", "policy", "policies"]);
const PRODUCT_ALIASES = new Set(["warranty", "warranties", "purchase", "purchases"]);

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";

  // #205/#328/#395 — the same filter parameters as the lists (?due=,
  // ?missing=details, ?review=1, ?noDocument=1, ?important=1), with the
  // rules from src/lib/recordFilters.ts and src/lib/listDue.ts. The old
  // single `filter=` values still work. Filters narrow Contracts and
  // Warranties (all filters), Vehicles (Due and Missing key details;
  // Vehicles are left out under any other filter) and Inventory items
  // (Missing key details only; left out under any other filter). Trips,
  // Property, Wealth and Document-name hits don't take part in filters:
  // they only appear for search text, and then unfiltered.
  const filters = parseSearchFilters(request.nextUrl.searchParams);
  const filter = hasListFilters(filters);
  const vehicleFilterOnly = !filters.review && !filters.noDocument && !filters.important;

  const textOk = q.length >= 2;
  if (!textOk && !filter) {
    return NextResponse.json({ groups: {} }, { headers: { "Cache-Control": "no-store" } });
  }

  // #384 — Due is the Due policy's, exactly as on the lists: each query
  // narrows roughly and the filter's `matches` decides in memory (ADR 0002),
  // so Search has no end-date range of its own.
  const dueContext = filters.due ? await getDueContext() : null;
  const contractDue = filters.due && dueContext ? contractDueFilter(filters.due, dueContext) : null;
  const warrantyDue = filters.due && dueContext ? warrantyDueFilter(filters.due, dueContext) : null;
  const vehicleDue = filters.due && dueContext ? vehicleDueFilter(filters.due, dueContext) : null;

  const enabledModules = await getEnabledModuleKeys();
  const contains = { contains: q };
  const qNormalized = q.toLowerCase();
  const isContractAlias = textOk && CONTRACT_ALIASES.has(qNormalized);
  const isProductAlias = textOk && PRODUCT_ALIASES.has(qNormalized);
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
            ...(textOk && !isContractAlias
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
            ...(contractDue ? [contractDue.where] : []),
            ...contractFilterWheres(filters),
          ],
        },
        select: {
          id: true,
          title: true,
          provider: true,
          contractNumber: true,
          ...CONTRACT_MISSING_SELECT,
          ...CONTRACT_DUE_SELECT,
        },
        // Most-recent-first: relevant always, but load-bearing for
        // isContractAlias/missing* results, which can return far more rows
        // than LIMIT with no relevance signal to rank by otherwise.
        orderBy: { createdAt: "desc" },
        // Under Due the in-memory check runs first, so the limit applies after it.
        ...(contractDue ? {} : { take: LIMIT }),
      })
      .then((rows) => (contractDue ? rows.filter(contractDue.matches).slice(0, LIMIT) : rows))
      .then((rows) =>
        rows.map((r) => ({
          id: r.id,
          title: r.title,
          subtitle: filters.missingDetails
            ? missingSubtitle(contractMissingParts(r))
            : !isContractAlias && textOk && matchedViaFields(q, [r.contractNumber]) && !matchedViaFields(q, [r.title, r.provider])
              ? [r.provider, `№ ${r.contractNumber}`].filter(Boolean).join(" · ")
              : r.provider,
          href: `/contracts/${r.id}`,
          group: "Contracts",
          matchedInDocument: textOk && !isContractAlias ? !matchedViaFields(q, [r.title, r.provider, r.contractNumber]) : false,
        })),
      ),
  );

  queries.push(
    prisma.product
      .findMany({
        where: {
          deletedAt: null,
          AND: [
            ...(textOk && !isProductAlias
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
            ...(warrantyDue ? [warrantyDue.where] : []),
            ...productFilterWheres(filters),
          ],
        },
        select: {
          id: true,
          description: true,
          manufacturer: true,
          vendor: true,
          ...PRODUCT_MISSING_SELECT,
          ...WARRANTY_DUE_SELECT,
        },
        // See the equivalent comment on the contract query above.
        orderBy: { createdAt: "desc" },
        ...(warrantyDue ? {} : { take: LIMIT }),
      })
      .then((rows) => (warrantyDue ? rows.filter(warrantyDue.matches).slice(0, LIMIT) : rows))
      .then((rows) =>
        rows.map((r) => ({
          id: r.id,
          title: r.description,
          subtitle: filters.missingDetails
            ? missingSubtitle(productMissingParts(r))
            : !isProductAlias &&
              textOk &&
              matchedViaFields(q, [r.serialNumber, r.barcode]) &&
              !matchedViaFields(q, [r.description, r.manufacturer, r.vendor])
              ? [r.manufacturer, `# ${r.serialNumber ?? r.barcode}`].filter(Boolean).join(" · ")
              : (r.manufacturer ?? undefined),
          href: `/products/${r.id}`,
          group: "Products",
          matchedInDocument: textOk && !isProductAlias
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
            where: { id: { in: contractDocIds }, deletedAt: null, contract: { deletedAt: null } },
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
            where: { id: { in: productDocIds }, deletedAt: null, product: { deletedAt: null } },
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

  if (enabledModules.has("VEHICLES") && (textOk || filter) && vehicleFilterOnly) {
    queries.push(
      prisma.vehicle
        .findMany({
          where: {
            deletedAt: null,
            AND: [
              ...(textOk
                ? [
                    {
                      OR: [
                        { label: contains },
                        { make: contains },
                        { model: contains },
                        { licensePlate: contains },
                        { vin: contains },
                      ],
                    },
                  ]
                : []),
              // A Vehicle has a Due entry per date (rego, insurance, next
              // service); any one of them in the state asked for matches.
              ...(vehicleDue ? [vehicleDue.where] : []),
              // No review/noDocument/important equivalent: vehicles have no
              // extraction-review flag, so those filters skip vehicles
              // entirely (vehicleFilterOnly above).
              ...vehicleFilterWheres(filters),
            ],
          },
          select: { id: true, label: true, make: true, model: true, ...VEHICLE_MISSING_SELECT, ...VEHICLE_DUE_SELECT },
          // See the equivalent comment on the contract query above.
          orderBy: { createdAt: "desc" },
          ...(vehicleDue ? {} : { take: LIMIT }),
        })
        .then((rows) => (vehicleDue ? rows.filter(vehicleDue.matches).slice(0, LIMIT) : rows))
        .then((rows) =>
          rows.map((r) => ({
            id: r.id,
            title: r.label,
            subtitle: filters.missingDetails
              ? missingSubtitle(vehicleMissingParts(r))
              : textOk && matchedViaFields(q, [r.vin, r.licensePlate]) && !matchedViaFields(q, [r.make, r.model])
                ? [[r.make, r.model].filter(Boolean).join(" "), r.licensePlate ?? r.vin]
                    .filter(Boolean)
                    .join(" · ")
                : [r.make, r.model].filter(Boolean).join(" ") || undefined,
            href: `/vehicles/${r.id}`,
            group: "Vehicles",
          })),
        ),
    );

    const vehicleItemDocIds = textOk ? hitDocIds(ftsHits, "VEHICLE_ITEM") : [];
    if (vehicleItemDocIds.length > 0) {
      queries.push(
        prisma.vehicleItemDocument
          .findMany({
            where: { id: { in: vehicleItemDocIds }, deletedAt: null, vehicleItem: { deletedAt: null, vehicle: { deletedAt: null } } },
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
            where: { id: { in: tripSegmentDocIds }, deletedAt: null, tripSegment: { trip: { deletedAt: null } } },
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
            href: `/home/${r.propertyId}`,
            group: "Property",
          })),
        ),
    );

    const homeItemDocIds = hitDocIds(ftsHits, "HOME_ITEM");
    if (homeItemDocIds.length > 0) {
      queries.push(
        prisma.homeItemDocument
          .findMany({
            where: { id: { in: homeItemDocIds }, deletedAt: null, homeItem: { deletedAt: null, property: { deletedAt: null } } },
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
                href: `/home/${r.homeItem.propertyId}`,
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
            where: { id: { in: rentalStatementDocIds }, deletedAt: null, rentalStatement: { property: { deletedAt: null } } },
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
                href: `/home/${r.rentalStatement.propertyId}/rental`,
                group: "Documents",
              })),
          ),
      );
    }
  }

  // Inventory items only have Missing key details; any other filter leaves them out.
  const inventoryFilterOk = !filter || (filters.missingDetails && !filters.due && vehicleFilterOnly);
  if (enabledModules.has("INVENTORY") && (textOk || filter) && inventoryFilterOk) {
    queries.push(
      prisma.inventoryItem
        .findMany({
          where: {
            deletedAt: null,
            AND: [
              ...(textOk ? [{ OR: [{ label: contains }, { brand: contains }, { model: contains }] }] : []),
              ...(filters.missingDetails ? [inventoryRules.missingDetails.where] : []),
            ],
          },
          select: { id: true, label: true, brand: true, deletedAt: true, serialNumber: true },
          // See the equivalent comment on the contract query above.
          orderBy: { createdAt: "desc" },
          take: LIMIT,
        })
        .then((rows) =>
          rows.map((r) => ({
            id: r.id,
            title: r.label,
            subtitle: filters.missingDetails ? missingSubtitle(inventoryMissingParts(r)) : (r.brand ?? undefined),
            href: `/inventory/${r.id}`,
            group: "Inventory",
          })),
        ),
    );

    const inventoryItemDocIds = textOk ? hitDocIds(ftsHits, "INVENTORY_ITEM") : [];
    if (inventoryItemDocIds.length > 0) {
      queries.push(
        prisma.inventoryItemDocument
          .findMany({
            where: { id: { in: inventoryItemDocIds }, deletedAt: null, inventoryItem: { deletedAt: null } },
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
            where: { id: { in: tradeDocIds }, deletedAt: null },
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
                href: `/wealth/portfolios/${r.trade.holding.portfolioId}/holdings/${r.trade.holding.id}`,
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
