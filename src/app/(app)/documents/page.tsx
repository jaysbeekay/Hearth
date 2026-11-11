import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { DocumentsExplorer, type DocRow } from "@/components/DocumentsExplorer";
import { pendingImportCount } from "@/lib/mcp/imports";
import { DocumentsTabs, DocumentsUploadActions } from "@/components/DocumentsTabs";
import { documentsEmptyMessage } from "@/lib/documents/emptyMessage";
import { auth } from "@/lib/auth";
import { documentFileHref } from "@/lib/documents/kinds";
import { documentTypeLabel } from "@/lib/documents/documentList";
import { getUserPreferences } from "@/lib/userPreferences";
import { formatDate } from "@/lib/utils";
import { LIVE_DOCUMENT_WHERE as LIVE } from "@/lib/documents/liveDocuments";
import { canWrite as sessionCanWrite } from "@/lib/readOnly";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { chipClass } from "@/lib/ui";
import { PageShell } from "@/components/ui/PageShell";

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

interface TypeSource {
  type: string;
  count: () => Promise<number>;
  fetchPage: (skip: number, take: number) => Promise<DocRow[]>;
}

// #617 — `typeLabel` and `ownerName` describe a previewed image the same way
// the record's own Document list does (DocumentList), so the alt text matches.
function buildSources(enabledModules: Set<string>, dateFormat: string | null): TypeSource[] {
  const sources: TypeSource[] = [
    {
      type: "Contracts",
      count: () => prisma.document.count({ where: LIVE.CONTRACT }),
      fetchPage: (skip, take) =>
        prisma.document
          .findMany({
            skip,
            take,
            where: LIVE.CONTRACT,
            orderBy: { uploadedAt: "desc" },
            select: {
              id: true,
              filename: true,
              size: true,
              uploadedAt: true,
              mimeType: true,
              category: true,
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
              category: r.category,
              type: "Contracts",
              parentTitle: r.contract.title,
              typeLabel: documentTypeLabel(r),
              ownerName: r.contract.title,
              parentHref: `/contracts/${r.contract.id}`,
              downloadHref: documentFileHref(r.id),
            })),
          ),
    },
    {
      type: "Warranties",
      count: () => prisma.productDocument.count({ where: LIVE.PRODUCT }),
      fetchPage: (skip, take) =>
        prisma.productDocument
          .findMany({
            skip,
            take,
            where: LIVE.PRODUCT,
            orderBy: { uploadedAt: "desc" },
            select: {
              id: true,
              filename: true,
              size: true,
              uploadedAt: true,
              mimeType: true,
              category: true,
              kind: true,
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
              category: r.category,
              type: "Warranties",
              parentTitle: r.product.description,
              typeLabel: documentTypeLabel(r, r.kind),
              ownerName: r.product.description,
              parentHref: `/products/${r.product.id}`,
              downloadHref: documentFileHref(r.id),
            })),
          ),
    },
  ];

  if (enabledModules.has("VEHICLES")) {
    sources.push({
      type: "Vehicles",
      count: () => prisma.vehicleItemDocument.count({ where: LIVE.VEHICLE_ITEM }),
      fetchPage: (skip, take) =>
        prisma.vehicleItemDocument
          .findMany({
            skip,
            take,
            where: LIVE.VEHICLE_ITEM,
            orderBy: { uploadedAt: "desc" },
            select: {
              id: true,
              filename: true,
              size: true,
              uploadedAt: true,
              mimeType: true,
              category: true,
              vehicleItem: { select: { vehicleId: true, title: true, vehicle: { select: { label: true } } } },
            },
          })
          .then((rows) =>
            rows.map((r) => ({
              id: r.id,
              filename: r.filename,
              size: r.size,
              uploadedAt: r.uploadedAt,
              mimeType: r.mimeType,
              category: r.category,
              type: "Vehicles",
              parentTitle: r.vehicleItem.vehicle.label,
              typeLabel: documentTypeLabel(r),
              ownerName: r.vehicleItem.title,
              parentHref: `/vehicles/${r.vehicleItem.vehicleId}`,
              downloadHref: documentFileHref(r.id),
            })),
          ),
    });
  }

  if (enabledModules.has("TRAVEL")) {
    sources.push({
      type: "Travel",
      count: () => prisma.tripSegmentDocument.count({ where: LIVE.TRIP_SEGMENT }),
      fetchPage: (skip, take) =>
        prisma.tripSegmentDocument
          .findMany({
            skip,
            take,
            where: LIVE.TRIP_SEGMENT,
            orderBy: { uploadedAt: "desc" },
            select: {
              id: true,
              filename: true,
              size: true,
              uploadedAt: true,
              mimeType: true,
              category: true,
              tripSegment: { select: { tripId: true, title: true, trip: { select: { title: true } } } },
            },
          })
          .then((rows) =>
            rows.map((r) => ({
              id: r.id,
              filename: r.filename,
              size: r.size,
              uploadedAt: r.uploadedAt,
              mimeType: r.mimeType,
              category: r.category,
              type: "Travel",
              parentTitle: r.tripSegment.trip.title,
              typeLabel: documentTypeLabel(r),
              ownerName: r.tripSegment.title,
              parentHref: `/travel/${r.tripSegment.tripId}`,
              downloadHref: documentFileHref(r.id),
            })),
          ),
    });
  }

  if (enabledModules.has("HOME")) {
    sources.push({
      type: "Properties",
      count: () =>
        Promise.all([
          prisma.homeItemDocument.count({ where: LIVE.HOME_ITEM }),
          prisma.rentalStatementDocument.count({ where: LIVE.RENTAL_STATEMENT }),
        ]).then(
          ([a, b]) => a + b,
        ),
      fetchPage: (skip, take) =>
        Promise.all([
          prisma.homeItemDocument.findMany({
            skip,
            take,
            where: LIVE.HOME_ITEM,
            orderBy: { uploadedAt: "desc" },
            select: {
              id: true,
              filename: true,
              size: true,
              uploadedAt: true,
              mimeType: true,
              category: true,
              homeItem: { select: { id: true, title: true, propertyId: true } },
            },
          }),
          prisma.rentalStatementDocument.findMany({
            skip,
            take,
            where: LIVE.RENTAL_STATEMENT,
            orderBy: { uploadedAt: "desc" },
            select: {
              id: true,
              filename: true,
              size: true,
              uploadedAt: true,
              mimeType: true,
              category: true,
              rentalStatement: { select: { propertyId: true, statementDate: true, periodEnd: true } },
            },
          }),
        ]).then(([homeItemRows, rentalRows]) => {
          const rows: DocRow[] = homeItemRows.map((r) => ({
            id: r.id,
            filename: r.filename,
            size: r.size,
            uploadedAt: r.uploadedAt,
            mimeType: r.mimeType,
            category: r.category,
            type: "Properties",
            parentTitle: r.homeItem.title,
            typeLabel: documentTypeLabel(r),
            ownerName: r.homeItem.title,
            parentHref: `/home/${r.homeItem.propertyId}`,
            downloadHref: documentFileHref(r.id),
          }));
          rows.push(
            ...rentalRows.map((r) => ({
              id: r.id,
              filename: r.filename,
              size: r.size,
              uploadedAt: r.uploadedAt,
              mimeType: r.mimeType,
              category: r.category,
              type: "Properties",
              parentTitle: "Rental statement",
              typeLabel: documentTypeLabel(r),
              ownerName: `statement ${formatDate(r.rentalStatement.statementDate ?? r.rentalStatement.periodEnd, dateFormat)}`,
              parentHref: `/home/${r.rentalStatement.propertyId}/rental`,
              downloadHref: documentFileHref(r.id),
            })),
          );
          return rows.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime()).slice(0, take);
        }),
    });
  }

  if (enabledModules.has("INVENTORY")) {
    sources.push({
      type: "Inventory",
      count: () => prisma.inventoryItemDocument.count({ where: LIVE.INVENTORY_ITEM }),
      fetchPage: (skip, take) =>
        prisma.inventoryItemDocument
          .findMany({
            skip,
            take,
            where: LIVE.INVENTORY_ITEM,
            orderBy: { uploadedAt: "desc" },
            select: {
              id: true,
              filename: true,
              size: true,
              uploadedAt: true,
              mimeType: true,
              category: true,
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
            category: r.category,
              type: "Inventory",
              parentTitle: r.inventoryItem.label,
              typeLabel: documentTypeLabel(r),
              ownerName: r.inventoryItem.label,
              parentHref: `/inventory/${r.inventoryItem.id}`,
              downloadHref: documentFileHref(r.id),
            })),
          ),
    });
  }

  if (enabledModules.has("WEALTH")) {
    sources.push({
      type: "Wealth",
      count: () => prisma.tradeDocument.count({ where: LIVE.TRADE }),
      fetchPage: (skip, take) =>
        prisma.tradeDocument
          .findMany({
            skip,
            take,
            where: LIVE.TRADE,
            orderBy: { uploadedAt: "desc" },
            select: {
              id: true,
              filename: true,
              size: true,
              uploadedAt: true,
              mimeType: true,
              category: true,
              trade: { select: { date: true, holding: { select: { id: true, ticker: true, portfolioId: true } } } },
            },
          })
          .then((rows) =>
            rows.map((r) => ({
              id: r.id,
              filename: r.filename,
              size: r.size,
              uploadedAt: r.uploadedAt,
              mimeType: r.mimeType,
              category: r.category,
              type: "Wealth",
              typeLabel: documentTypeLabel(r),
              ownerName: `trade ${formatDate(r.trade.date, dateFormat)}`,
              parentTitle: r.trade.holding.ticker,
              parentHref: `/wealth/portfolios/${r.trade.holding.portfolioId}/holdings/${r.trade.holding.id}`,
              downloadHref: documentFileHref(r.id),
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
          // The Inbox is a location, not a record: the alt names no owner.
          ownerName: null,
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
  const session = await auth();
  const canWrite = sessionCanWrite(session);
  const showAll = view === "all";
  const page = Math.max(0, Number(pageParam) || 0);

  const [enabledModules, { dateFormat }] = await Promise.all([getEnabledModuleKeys(), getUserPreferences()]);

  const filedSources = buildSources(enabledModules, dateFormat);
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

  // null makes the explorer show its "Upload a document" empty state, which a
  // read-only member can't use, so they get plain text instead.
  let emptyMessage: string | null = documentsEmptyMessage(type, showAll);
  if (totalCount === 0) {
    emptyMessage = canWrite ? null : "No documents uploaded yet.";
  }

  const importsCount = await pendingImportCount();

  return (
    <PageShell width="list">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-medium">Documents</h1>
          <p className="text-sm text-muted">
            {showAll
              ? "Every uploaded document, including anything still waiting to be filed."
              : "Documents you've saved to a contract, warranty, or other record."}
          </p>
        </div>
        {canWrite && <DocumentsUploadActions />}
      </div>

      <DocumentsTabs
        active={showAll ? "all" : "filed"}
        inboxCount={inboxCount}
        filedCount={filedCount}
        allCount={totalCount}
        importsCount={importsCount}
      />

      {totalCount > 0 && (
        // #366 — which area a Document belongs to; its Document type is the
        // select below.
        <div role="group" aria-labelledby="documents-belongs-to" className="flex flex-wrap items-center gap-2">
          <span id="documents-belongs-to" className="text-sm text-muted">
            Belongs to
          </span>
          <Link href={showAll ? "/documents?view=all" : "/documents"} className={chipClass(!type)}>
            All ({showAll ? totalCount : filedCount})
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
        emptyMessage={emptyMessage}
      />

      {(page > 0 || hasMore) && (
        <div className="flex items-center justify-between border-t border-border pt-4">
          {page > 0 ? (
            <Link
              href={`/documents?page=${page - 1}${type ? `&type=${encodeURIComponent(type)}` : ""}${showAll ? "&view=all" : ""}`}
              className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
            >
              <ChevronLeft size={16} aria-hidden />
              Newer
            </Link>
          ) : (
            <span />
          )}
          {hasMore && (
            <Link
              href={`/documents?page=${page + 1}${type ? `&type=${encodeURIComponent(type)}` : ""}${showAll ? "&view=all" : ""}`}
              className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
            >
              Older
              <ChevronRight size={16} aria-hidden />
            </Link>
          )}
        </div>
      )}
    </PageShell>
  );
}
