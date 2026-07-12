import { prisma } from "@/lib/prisma";
import type { ModuleKey } from "@/lib/modules/registry";

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface DocumentStats {
  uploadedThisWeek: number;
  needsReview: number;
  total: number;
}

// Aggregates counts across every per-entity document table (gated the same
// way /documents itself is) plus the inbox, for the dashboard's document
// summary section.
export async function getDocumentStats(enabledModules: Set<ModuleKey>): Promise<DocumentStats> {
  const since = new Date(Date.now() - ONE_WEEK_MS);

  const totalQueries: Promise<number>[] = [
    prisma.document.count(),
    prisma.productDocument.count(),
    prisma.inboxDocument.count(),
  ];
  const recentQueries: Promise<number>[] = [
    prisma.document.count({ where: { uploadedAt: { gte: since } } }),
    prisma.productDocument.count({ where: { uploadedAt: { gte: since } } }),
    prisma.inboxDocument.count({ where: { uploadedAt: { gte: since } } }),
  ];

  if (enabledModules.has("VEHICLES")) {
    totalQueries.push(prisma.vehicleItemDocument.count());
    recentQueries.push(prisma.vehicleItemDocument.count({ where: { uploadedAt: { gte: since } } }));
  }
  if (enabledModules.has("TRAVEL")) {
    totalQueries.push(prisma.tripSegmentDocument.count());
    recentQueries.push(prisma.tripSegmentDocument.count({ where: { uploadedAt: { gte: since } } }));
  }
  if (enabledModules.has("HOME")) {
    totalQueries.push(prisma.homeItemDocument.count(), prisma.rentalStatementDocument.count());
    recentQueries.push(
      prisma.homeItemDocument.count({ where: { uploadedAt: { gte: since } } }),
      prisma.rentalStatementDocument.count({ where: { uploadedAt: { gte: since } } }),
    );
  }
  if (enabledModules.has("INVENTORY")) {
    totalQueries.push(prisma.inventoryItemDocument.count());
    recentQueries.push(prisma.inventoryItemDocument.count({ where: { uploadedAt: { gte: since } } }));
  }
  if (enabledModules.has("WEALTH")) {
    totalQueries.push(prisma.tradeDocument.count());
    recentQueries.push(prisma.tradeDocument.count({ where: { uploadedAt: { gte: since } } }));
  }

  const [totals, recents, needsReview] = await Promise.all([
    Promise.all(totalQueries),
    Promise.all(recentQueries),
    prisma.inboxDocument.count(),
  ]);

  return {
    total: totals.reduce((sum, n) => sum + n, 0),
    uploadedThisWeek: recents.reduce((sum, n) => sum + n, 0),
    needsReview,
  };
}
