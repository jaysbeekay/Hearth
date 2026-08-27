import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { getUserPreferences } from "@/lib/userPreferences";
import { DocumentsExplorer, type DocRow } from "@/components/DocumentsExplorer";
import { DocumentsTabs } from "@/components/DocumentsTabs";

export const metadata: Metadata = { title: "Documents" };

function chipClass(active: boolean) {
  return `rounded-full border px-3 py-1 text-xs font-medium ${
    active
      ? "border-accent bg-accent/10 text-accent"
      : "border-border text-muted hover:border-accent/50"
  }`;
}

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; view?: string }>;
}) {
  const { type, view } = await searchParams;
  const showAll = view === "all";
  const [enabledModules, { dateFormat }, inboxDocs] = await Promise.all([
    getEnabledModuleKeys(),
    getUserPreferences(),
    prisma.inboxDocument.findMany({
      select: { id: true, filename: true, size: true, uploadedAt: true, mimeType: true },
    }),
  ]);

  const queries: Promise<DocRow[]>[] = [];

  queries.push(
    prisma.document
      .findMany({ select: { id: true, filename: true, size: true, uploadedAt: true, mimeType: true, contract: { select: { id: true, title: true } } } })
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
  );

  queries.push(
    prisma.productDocument
      .findMany({ select: { id: true, filename: true, size: true, uploadedAt: true, mimeType: true, product: { select: { id: true, description: true } } } })
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
  );

  if (enabledModules.has("VEHICLES")) {
    queries.push(
      prisma.vehicleItemDocument
        .findMany({
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
    );
  }

  if (enabledModules.has("TRAVEL")) {
    queries.push(
      prisma.tripSegmentDocument
        .findMany({
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
    );
  }

  if (enabledModules.has("HOME")) {
    queries.push(
      prisma.homeItemDocument
        .findMany({
          select: {
            id: true,
            filename: true,
            size: true,
            uploadedAt: true,
            mimeType: true,
            homeItem: { select: { id: true, title: true, propertyId: true } },
          },
        })
        .then((rows) =>
          rows.map((r) => ({
            id: r.id,
            filename: r.filename,
            size: r.size,
            uploadedAt: r.uploadedAt,
            mimeType: r.mimeType,
            type: "Property",
            parentTitle: r.homeItem.title,
            parentHref: `/home/${r.homeItem.propertyId}/items/${r.homeItem.id}`,
            downloadHref: `/api/home/documents/${r.id}`,
          })),
        ),
    );

    queries.push(
      prisma.rentalStatementDocument
        .findMany({
          select: {
            id: true,
            filename: true,
            size: true,
            uploadedAt: true,
            mimeType: true,
            rentalStatement: { select: { propertyId: true } },
          },
        })
        .then((rows) =>
          rows.map((r) => ({
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
        ),
    );
  }

  if (enabledModules.has("INVENTORY")) {
    queries.push(
      prisma.inventoryItemDocument
        .findMany({
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
    );
  }

  if (enabledModules.has("WEALTH")) {
    queries.push(
      prisma.tradeDocument
        .findMany({
          select: {
            id: true,
            filename: true,
            size: true,
            uploadedAt: true,
            mimeType: true,
            trade: {
              select: {
                holding: { select: { id: true, ticker: true, portfolioId: true } },
              },
            },
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
    );
  }

  const filedDocs = (await Promise.all(queries)).flat();
  const inboxRows: DocRow[] = inboxDocs.map((d) => ({
    id: d.id,
    filename: d.filename,
    size: d.size,
    uploadedAt: d.uploadedAt,
    mimeType: d.mimeType,
    type: "Inbox",
    parentTitle: "Inbox",
    parentHref: "/documents/inbox",
    downloadHref: `/api/documents/inbox/${d.id}`,
  }));

  const baseDocs = showAll ? [...filedDocs, ...inboxRows] : filedDocs;
  baseDocs.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());

  const filtered = type ? baseDocs.filter((d) => d.type === type) : baseDocs;
  const availableTypes = [...new Set(baseDocs.map((d) => d.type))];

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
        inboxCount={inboxDocs.length}
        filedCount={filedDocs.length}
        allCount={filedDocs.length + inboxDocs.length}
      />

      {baseDocs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Link href={showAll ? "/documents?view=all" : "/documents"} className={chipClass(!type)}>
            All types ({baseDocs.length})
          </Link>
          {availableTypes.map((t) => (
            <Link
              key={t}
              href={`/documents?type=${encodeURIComponent(t)}${showAll ? "&view=all" : ""}`}
              className={chipClass(type === t)}
            >
              {t} ({baseDocs.filter((d) => d.type === t).length})
            </Link>
          ))}
        </div>
      )}

      <DocumentsExplorer
        docs={filtered}
        dateFormat={dateFormat}
        emptyMessage={
          baseDocs.length === 0 ? null : `No ${type?.toLowerCase()} documents yet.`
        }
      />
    </div>
  );
}
