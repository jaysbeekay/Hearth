import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { getUserPreferences } from "@/lib/userPreferences";
import { DocumentsExplorer, type DocRow } from "@/components/DocumentsExplorer";
import { DocumentsTabs } from "@/components/DocumentsTabs";

export const metadata: Metadata = { title: "Documents" };

// #252 — every query below used to be a bare findMany() with no take/skip,
// fetching this household's entire document history on every page view.
const PAGE_SIZE = 20;
// When no type filter narrows to one table, there's no single cursor across
// 9 different Prisma models to page through cleanly — SQLite has no native
// cross-table keyset primitive short of a hand-written UNION query. Instead,
// each table contributes at most this many of its newest rows; the merged,
// sorted result is then paginated in memory. This bounds the fetch to a
// fixed ceiling (up to PER_TABLE_CAP × number of tables) instead of the
// unbounded "every document ever uploaded" it was before — the one accepted
// imprecision is a page boundary that falls in the middle of a table's
// contribution, which can't happen with real DB-level pagination but no
// longer risks loading thousands of rows either.
const PER_TABLE_CAP = 100;

function chipClass(active: boolean) {
  return `rounded-full border px-3 py-1 text-xs font-medium ${
    active
      ? "border-accent bg-accent/10 text-accent"
      : "border-border text-muted hover:border-accent/50"
  }`;
}

interface TypeSource {
  type: string;
  count: () => Promise<number>;
  fetchPage: (skip: number, take: number) => Promise<DocRow[]>;
}

function buildSources(enabledModules: Set<string>): TypeSource[] {
  const sources: TypeSource[] = [
    {
      type: "Contracts",
      count: () => prisma.document.count(),
      fetchPage: (skip, take) =>
        prisma.document
          .findMany({
            skip,
            take,
            orderBy: { uploadedAt: "desc" },
            select: {
              id: true,
              filename: true,
              size: true,
              uploadedAt: true,
              mimeType: true,
              contract: { select: { id: true, title: true } },
            },
          })
          .then((rows) =>
            rows.map((r) => ({
              id: r.id,
              filename: r.filename,
              size: r.size,
              uploadedAt: r.uploadedAt,
              mimeType: r.mimeType,
              type: "Contracts",
              parentTitle: r.contract.title,
              parentHref: `/contracts/${r.contract.id}`,
              downloadHref: `/api/documents/${r.id}`,
            })),
          ),
    },
    {
      type: "Warranties",
      count: () => prisma.productDocument.count(),
      fetchPage: (skip, take) =>
        prisma.productDocument
          .findMany({
            skip,
            take,
            orderBy: { uploadedAt: "desc" },
            select: {
              id: true,
              filename: true,
              size: true,
              uploadedAt: true,
              mimeType: true,
              product: { select: { id: true, description: true } },
            },
          })
          .then((rows) =>
            rows.map((r) => ({
              id: r.id,
              filename: r.filename,
              size: r.size,
              uploadedAt: r.uploadedAt,
              mimeType: r.mimeType,
              type: "Warranties",
              parentTitle: r.product.description,
              parentHref: `/products/${r.product.id}`,
              downloadHref: `/api/products/documents/${r.id}`,
            })),
          ),
    },
  ];

  if (enabledModules.has("VEHICLES")) {
    sources.push({
      type: "Vehicles",
      count: () => prisma.vehicleItemDocument.count(),
      fetchPage: (skip, take) =>
        prisma.vehicleItemDocument
          .findMany({
            skip,
            take,
            orderBy: { uploadedAt: "desc" },
            select: {
              id: true,
              filename: true,
              size: true,
              uploadedAt: true,
              mimeType: true,
              vehicleItem: { select: { vehicleId: true, vehicle: { select: { label: true } } } },
            },
          })
          .then((rows) =>
            rows.map((r) => ({
              id: r.id,
              filename: r.filename,
              size: r.size,
              uploadedAt: r.uploadedAt,
              mimeType: r.mimeType,
              type: "Vehicles",
              parentTitle: r.vehicleItem.vehicle.label,
              parentHref: `/vehicles/${r.vehicleItem.vehicleId}`,
              downloadHref: `/api/vehicles/documents/${r.id}`,
            })),
          ),
    });
  }

  if (enabledModules.has("TRAVEL")) {
    sources.push({
      type: "Travel",
      count: () => prisma.tripSegmentDocument.count(),
      fetchPage: (skip, take) =>
        prisma.tripSegmentDocument
          .findMany({
            skip,
            take,
            orderBy: { uploadedAt: "desc" },
            select: {
              id: true,
              filename: true,
              size: true,
              uploadedAt: true,
              mimeType: true,
              tripSegment: { select: { tripId: true, trip: { select: { title: true } } } },
            },
          })
          .then((rows) =>
            rows.map((r) => ({
              id: r.id,
              filename: r.filename,
              size: r.size,
              uploadedAt: r.uploadedAt,
              mimeType: r.mimeType,
              type: "Travel",
              parentTitle: r.tripSegment.trip.title,
              parentHref: `/travel/${r.tripSegment.tripId}`,
              downloadHref: `/api/travel/documents/${r.id}`,
            })),
          ),
    });
  }

  if (enabledModules.has("HOME")) {
    sources.push({
      type: "Property",
      count: () =>
        Promise.all([prisma.homeItemDocument.count(), prisma.rentalStatementDocument.count()]).then(
          ([a, b]) => a + b,
        ),
      fetchPage: (skip, take) =>
        Promise.all([
          prisma.homeItemDocument.findMany({
            skip,
            take,
            orderBy: { uploadedAt: "desc" },
            select: {
              id: true,
              filename: true,
              size: true,
              uploadedAt: true,
              mimeType: true,
              homeItem: { select: { id: true, title: true, propertyId: true } },
            },
          }),
          prisma.rentalStatementDocument.findMany({
            skip,
            take,
            orderBy: { uploadedAt: "desc" },
            select: {
              id: true,
              filename: true,
              size: true,
              uploadedAt: true,
              mimeType: true,
              rentalStatement: { select: { propertyId: true } },
            },
          }),
        ]).then(([homeItemRows, rentalRows]) => {
          const rows: DocRow[] = homeItemRows.map((r) => ({
            id: r.id,
            filename: r.filename,
            size: r.size,
            uploadedAt: r.uploadedAt,
            mimeType: r.mimeType,
            type: "Property",
            parentTitle: r.homeItem.title,
            parentHref: `/home/${r.homeItem.propertyId}/items/${r.homeItem.id}`,
            downloadHref: `/api/home/documents/${r.id}`,
          }));
          rows.push(
            ...rentalRows.map((r) => ({
              id: r.id,
              filename: r.filename,
              size: r.size,
              uploadedAt: r.uploadedAt,
              mimeType: r.mimeType,
              type: "Property",
              parentTitle: "Rental statement",
              parentHref: `/home/${r.rentalStatement.propertyId}/rental`,
              downloadHref: `/api/home/rental-documents/${r.id}`,
            })),
          );
          return rows.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime()).slice(0, take);
        }),
    });
  }

  if (enabledModules.has("INVENTORY")) {
    sources.push({
      type: "Inventory",
      count: () => prisma.inventoryItemDocument.count(),
      fetchPage: (skip, take) =>
        prisma.inventoryItemDocument
          .findMany({
            skip,
            take,
            orderBy: { uploadedAt: "desc" },
            select: {
              id: true,
              filename: true,
              size: true,
              uploadedAt: true,
              mimeType: true,
              inventoryItem: { select: { id: true, label: true } },
            },
          })
          .then((rows) =>
            rows.map((r) => ({
              id: r.id,
              filename: r.filename,
              size: r.size,
              uploadedAt: r.uploadedAt,
              mimeType: r.mimeType,
              type: "Inventory",
              parentTitle: r.inventoryItem.label,
              parentHref: `/inventory/${r.inventoryItem.id}`,
              downloadHref: `/api/inventory/documents/${r.id}`,
            })),
          ),
    });
  }

  if (enabledModules.has("WEALTH")) {
    sources.push({
      type: "Wealth",
      count: () => prisma.tradeDocument.count(),
      fetchPage: (skip, take) =>
        prisma.tradeDocument
          .findMany({
            skip,
            take,
            orderBy: { uploadedAt: "desc" },
            select: {
              id: true,
              filename: true,
              size: true,
              uploadedAt: true,
              mimeType: true,
              trade: { select: { holding: { select: { id: true, ticker: true, portfolioId: true } } } },
            },
          })
          .then((rows) =>
            rows.map((r) => ({
              id: r.id,
              filename: r.filename,
              size: r.size,
              uploadedAt: r.uploadedAt,
              mimeType: r.mimeType,
              type: "Wealth",
              parentTitle: r.trade.holding.ticker,
              parentHref: `/wealth/portfolios/${r.trade.holding.portfolioId}/holdings/${r.trade.holding.id}`,
              downloadHref: `/api/wealth/trade-documents/${r.id}`,
            })),
          ),
    });
  }

  return sources;
}

const INBOX_SOURCE: TypeSource = {
  type: "Inbox",
  count: () => prisma.inboxDocument.count(),
  fetchPage: (skip, take) =>
    prisma.inboxDocument
      .findMany({
        skip,
        take,
        orderBy: { uploadedAt: "desc" },
        select: { id: true, filename: true, size: true, uploadedAt: true, mimeType: true },
      })
      .then((rows) =>
        rows.map((d) => ({
          id: d.id,
          filename: d.filename,
          size: d.size,
          uploadedAt: d.uploadedAt,
          mimeType: d.mimeType,
          type: "Inbox",
          parentTitle: "Inbox",
          parentHref: "/documents/inbox",
          downloadHref: `/api/documents/inbox/${d.id}`,
        })),
      ),
};

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; view?: string; page?: string }>;
}) {
  const { type, view, page: pageParam } = await searchParams;
  const showAll = view === "all";
  const page = Math.max(0, Number(pageParam) || 0);

  const [enabledModules, { dateFormat }] = await Promise.all([
    getEnabledModuleKeys(),
    getUserPreferences(),
  ]);

  const filedSources = buildSources(enabledModules);
  const activeSources = showAll ? [...filedSources, INBOX_SOURCE] : filedSources;

  const [filedCount, inboxCount, counts] = await Promise.all([
    Promise.all(filedSources.map((s) => s.count())).then((n) => n.reduce((a, b) => a + b, 0)),
    prisma.inboxDocument.count(),
    Promise.all(activeSources.map(async (s) => [s.type, await s.count()] as const)),
  ]);
  const totalCount = filedCount + inboxCount;
  const countsByType = new Map(counts);

  let docs: DocRow[];
  let hasMore: boolean;

  if (type) {
    const source = activeSources.find((s) => s.type === type);
    const rows = source ? await source.fetchPage(page * PAGE_SIZE, PAGE_SIZE + 1) : [];
    hasMore = rows.length > PAGE_SIZE;
    docs = rows.slice(0, PAGE_SIZE);
  } else {
    const perTablePages = await Promise.all(activeSources.map((s) => s.fetchPage(0, PER_TABLE_CAP)));
    const merged = perTablePages
      .flat()
      .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
    const windowRows = merged.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE + 1);
    hasMore = windowRows.length > PAGE_SIZE;
    docs = windowRows.slice(0, PAGE_SIZE);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Documents</h1>
        <p className="text-sm text-muted">
          {showAll
            ? "Every uploaded document, including anything still waiting to be filed."
            : "Documents you've saved to a contract, warranty, or other record."}
        </p>
      </div>

      <DocumentsTabs
        active={showAll ? "all" : "filed"}
        inboxCount={inboxCount}
        filedCount={filedCount}
        allCount={totalCount}
      />

      {totalCount > 0 && (
        <div className="flex flex-wrap gap-2">
          <Link href={showAll ? "/documents?view=all" : "/documents"} className={chipClass(!type)}>
            All types ({showAll ? totalCount : filedCount})
          </Link>
          {activeSources.map((s) => (
            <Link
              key={s.type}
              href={`/documents?type=${encodeURIComponent(s.type)}${showAll ? "&view=all" : ""}`}
              className={chipClass(type === s.type)}
            >
              {s.type} ({countsByType.get(s.type) ?? 0})
            </Link>
          ))}
        </div>
      )}

      <DocumentsExplorer
        docs={docs}
        dateFormat={dateFormat}
        emptyMessage={totalCount === 0 ? null : `No ${type?.toLowerCase()} documents yet.`}
      />

      {(page > 0 || hasMore) && (
        <div className="flex items-center justify-between border-t border-border pt-4">
          {page > 0 ? (
            <Link
              href={`/documents?page=${page - 1}${type ? `&type=${encodeURIComponent(type)}` : ""}${showAll ? "&view=all" : ""}`}
              className="text-sm text-accent hover:underline"
            >
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          {hasMore && (
            <Link
              href={`/documents?page=${page + 1}${type ? `&type=${encodeURIComponent(type)}` : ""}${showAll ? "&view=all" : ""}`}
              className="text-sm text-accent hover:underline"
            >
              Older →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
