import { prisma } from "@/lib/prisma";
import type { OwnedDocumentKind } from "@/lib/documents/kinds";
import type { DocumentVersionLink } from "@/lib/documents/documentList";

// #397 — the version links of Documents in Trash, so the Document list can
// walk a version chain past a version that's in Trash instead of splitting
// it in two. Only the id and supersedesId columns are read; the rows
// themselves are never shown.

interface LinkRow {
  ownerId: string;
  id: string;
  supersedesId: string | null;
}

const TRASHED = { deletedAt: { not: null } };
const LINK_SELECT = { id: true, supersedesId: true } as const;

async function trashedLinkRows(kind: OwnedDocumentKind, ownerIds: string[]): Promise<LinkRow[]> {
  switch (kind) {
    case "CONTRACT": {
      const rows = await prisma.document.findMany({
        where: { ...TRASHED, contractId: { in: ownerIds } },
        select: { ...LINK_SELECT, contractId: true },
      });
      return rows.map((r) => ({ ownerId: r.contractId, id: r.id, supersedesId: r.supersedesId }));
    }
    case "PRODUCT": {
      const rows = await prisma.productDocument.findMany({
        where: { ...TRASHED, productId: { in: ownerIds } },
        select: { ...LINK_SELECT, productId: true },
      });
      return rows.map((r) => ({ ownerId: r.productId, id: r.id, supersedesId: r.supersedesId }));
    }
    case "TRIP_SEGMENT": {
      const rows = await prisma.tripSegmentDocument.findMany({
        where: { ...TRASHED, tripSegmentId: { in: ownerIds } },
        select: { ...LINK_SELECT, tripSegmentId: true },
      });
      return rows.map((r) => ({ ownerId: r.tripSegmentId, id: r.id, supersedesId: r.supersedesId }));
    }
    case "RENTAL_STATEMENT": {
      const rows = await prisma.rentalStatementDocument.findMany({
        where: { ...TRASHED, rentalStatementId: { in: ownerIds } },
        select: { ...LINK_SELECT, rentalStatementId: true },
      });
      return rows.map((r) => ({ ownerId: r.rentalStatementId, id: r.id, supersedesId: r.supersedesId }));
    }
    case "HOME_ITEM": {
      const rows = await prisma.homeItemDocument.findMany({
        where: { ...TRASHED, homeItemId: { in: ownerIds } },
        select: { ...LINK_SELECT, homeItemId: true },
      });
      return rows.map((r) => ({ ownerId: r.homeItemId, id: r.id, supersedesId: r.supersedesId }));
    }
    case "VEHICLE_ITEM": {
      const rows = await prisma.vehicleItemDocument.findMany({
        where: { ...TRASHED, vehicleItemId: { in: ownerIds } },
        select: { ...LINK_SELECT, vehicleItemId: true },
      });
      return rows.map((r) => ({ ownerId: r.vehicleItemId, id: r.id, supersedesId: r.supersedesId }));
    }
    case "INVENTORY_ITEM": {
      const rows = await prisma.inventoryItemDocument.findMany({
        where: { ...TRASHED, inventoryItemId: { in: ownerIds } },
        select: { ...LINK_SELECT, inventoryItemId: true },
      });
      return rows.map((r) => ({ ownerId: r.inventoryItemId, id: r.id, supersedesId: r.supersedesId }));
    }
    case "TRADE": {
      const rows = await prisma.tradeDocument.findMany({
        where: { ...TRASHED, tradeId: { in: ownerIds } },
        select: { ...LINK_SELECT, tradeId: true },
      });
      return rows.map((r) => ({ ownerId: r.tradeId, id: r.id, supersedesId: r.supersedesId }));
    }
  }
}

/** The version links of each owner's Documents in Trash, keyed by owner id. */
export async function getTrashedVersionLinks(
  kind: OwnedDocumentKind,
  ownerIds: string[],
): Promise<Map<string, DocumentVersionLink[]>> {
  const byOwner = new Map<string, DocumentVersionLink[]>();
  if (ownerIds.length === 0) return byOwner;
  for (const row of await trashedLinkRows(kind, ownerIds)) {
    const links = byOwner.get(row.ownerId) ?? [];
    links.push({ id: row.id, supersedesId: row.supersedesId });
    byOwner.set(row.ownerId, links);
  }
  return byOwner;
}
