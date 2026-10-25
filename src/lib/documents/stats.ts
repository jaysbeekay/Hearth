import { prisma } from "@/lib/prisma";
import type { ModuleKey } from "@/lib/modules/registry";
import { LIVE_DOCUMENT_WHERE as LIVE } from "@/lib/documents/liveDocuments";

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface DocumentStats {
  uploadedThisWeek: number;
  // #289 — "unfiled inbox document" and "extraction-pending record" both
  // used to be called "needs review"; this is the former, distinct from
  // Contract/Product's own extractionPending-driven "needs review" chips.
  inboxCount: number;
  total: number;
}

/** Documents waiting in the household's Inbox: the nav badge on Documents (#369, #407). */
export function getInboxCount(): Promise<number> {
  return prisma.inboxDocument.count();
}

// Aggregates counts across every per-entity document table (gated the same
// way /documents itself is) plus the inbox, for the dashboard's document
// summary section. Documents in Trash, or under a record in Trash, aren't
// counted.
export async function getDocumentStats(enabledModules: Set<ModuleKey>): Promise<DocumentStats> {
  const since = new Date(Date.now() - ONE_WEEK_MS);

  const totalQueries: Promise<number>[] = [
    prisma.document.count({ where: LIVE.CONTRACT }),
    prisma.productDocument.count({ where: LIVE.PRODUCT }),
    prisma.inboxDocument.count(),
  ];
  const recentQueries: Promise<number>[] = [
    prisma.document.count({ where: { ...LIVE.CONTRACT, uploadedAt: { gte: since } } }),
    prisma.productDocument.count({ where: { ...LIVE.PRODUCT, uploadedAt: { gte: since } } }),
    prisma.inboxDocument.count({ where: { uploadedAt: { gte: since } } }),
  ];

  if (enabledModules.has("VEHICLES")) {
    totalQueries.push(prisma.vehicleItemDocument.count({ where: LIVE.VEHICLE_ITEM }));
    recentQueries.push(prisma.vehicleItemDocument.count({ where: { ...LIVE.VEHICLE_ITEM, uploadedAt: { gte: since } } }));
  }
  if (enabledModules.has("TRAVEL")) {
    totalQueries.push(prisma.tripSegmentDocument.count({ where: LIVE.TRIP_SEGMENT }));
    recentQueries.push(prisma.tripSegmentDocument.count({ where: { ...LIVE.TRIP_SEGMENT, uploadedAt: { gte: since } } }));
  }
  if (enabledModules.has("HOME")) {
    totalQueries.push(prisma.homeItemDocument.count({ where: LIVE.HOME_ITEM }), prisma.rentalStatementDocument.count({ where: LIVE.RENTAL_STATEMENT }));
    recentQueries.push(
      prisma.homeItemDocument.count({ where: { ...LIVE.HOME_ITEM, uploadedAt: { gte: since } } }),
      prisma.rentalStatementDocument.count({ where: { ...LIVE.RENTAL_STATEMENT, uploadedAt: { gte: since } } }),
    );
  }
  if (enabledModules.has("INVENTORY")) {
    totalQueries.push(prisma.inventoryItemDocument.count({ where: LIVE.INVENTORY_ITEM }));
    recentQueries.push(prisma.inventoryItemDocument.count({ where: { ...LIVE.INVENTORY_ITEM, uploadedAt: { gte: since } } }));
  }
  if (enabledModules.has("WEALTH")) {
    totalQueries.push(prisma.tradeDocument.count({ where: LIVE.TRADE }));
    recentQueries.push(prisma.tradeDocument.count({ where: { ...LIVE.TRADE, uploadedAt: { gte: since } } }));
  }

  const [totals, recents, inboxCount] = await Promise.all([
    Promise.all(totalQueries),
    Promise.all(recentQueries),
    prisma.inboxDocument.count(),
  ]);

  return {
    total: totals.reduce((sum, n) => sum + n, 0),
    uploadedThisWeek: recents.reduce((sum, n) => sum + n, 0),
    inboxCount,
  };
}
