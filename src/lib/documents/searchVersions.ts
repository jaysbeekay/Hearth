import { prisma } from "@/lib/prisma";
import type { OwnedDocumentKind } from "@/lib/documents/kinds";

// #398 follow-up — Search shows one result per Document, the way its
// record's page does: the latest version, with older versions under it
// (groupDocumentVersions). Old and new versions of a re-uploaded file are
// usually near-identical, so both used to match as two identical rows.

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each delegate has its own generated types; only id/supersedesId/deletedAt are read
type Delegate = any;

const DELEGATES: Record<OwnedDocumentKind, () => Delegate> = {
  CONTRACT: () => prisma.document,
  PRODUCT: () => prisma.productDocument,
  TRIP_SEGMENT: () => prisma.tripSegmentDocument,
  RENTAL_STATEMENT: () => prisma.rentalStatementDocument,
  HOME_ITEM: () => prisma.homeItemDocument,
  VEHICLE_ITEM: () => prisma.vehicleItemDocument,
  INVENTORY_ITEM: () => prisma.inventoryItemDocument,
  TRADE: () => prisma.tradeDocument,
};

/**
 * Each Document's latest version: the newest one after it that isn't in
 * Trash, walking past versions that are (as the record page does), or
 * itself when there's none. One query per step along the chains.
 */
export async function latestVersionIds(kind: OwnedDocumentKind, ids: string[]): Promise<Map<string, string>> {
  const successor = new Map<string, { id: string; live: boolean }>();
  const seen = new Set(ids);
  let frontier = ids;
  while (frontier.length > 0) {
    const rows: { id: string; supersedesId: string; deletedAt: Date | null }[] = await DELEGATES[kind]().findMany({
      where: { supersedesId: { in: frontier } },
      select: { id: true, supersedesId: true, deletedAt: true },
    });
    frontier = [];
    for (const row of rows) {
      successor.set(row.supersedesId, { id: row.id, live: row.deletedAt === null });
      if (!seen.has(row.id)) {
        seen.add(row.id);
        frontier.push(row.id);
      }
    }
  }
  const latest = new Map<string, string>();
  for (const id of ids) {
    let head = id;
    const visited = new Set([id]);
    for (let next = successor.get(id); next && !visited.has(next.id); next = successor.get(next.id)) {
      visited.add(next.id);
      if (next.live) head = next.id;
    }
    latest.set(id, head);
  }
  return latest;
}

/**
 * Keeps one hit per Document, from rows already in rank order: the latest
 * version when it matched, otherwise the best-ranked older version, marked
 * so the result can say so. The order is kept.
 */
export async function collapseVersionHits<T extends { id: string }>(
  kind: OwnedDocumentKind,
  rows: T[],
): Promise<(T & { olderVersion: boolean })[]> {
  if (rows.length === 0) return [];
  const latest = await latestVersionIds(
    kind,
    rows.map((r) => r.id),
  );
  const matched = new Set(rows.map((r) => r.id));
  const taken = new Set<string>();
  const kept: (T & { olderVersion: boolean })[] = [];
  for (const row of rows) {
    const head = latest.get(row.id) ?? row.id;
    if (taken.has(head)) continue;
    // The latest version matched too: it stands for the Document, in its own place.
    if (head !== row.id && matched.has(head)) continue;
    taken.add(head);
    kept.push({ ...row, olderVersion: head !== row.id });
  }
  return kept;
}
