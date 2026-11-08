import { prisma } from "@/lib/prisma";
import type { OwnedDocumentKind } from "@/lib/documents/kinds";

// #398 follow-up — Search shows one result per Document, the way its
// record's page does: the latest version, with older versions under it
// (groupDocumentVersions). Old and new versions of a re-uploaded file are
// usually near-identical, so both used to match as two identical rows.

interface Successor {
  id: string;
  /** The version this one replaced. */
  supersedesId: string;
  live: boolean;
  /** Whether a newer version replaced this one in turn. */
  replaced: boolean;
}

const SUCCESSOR_SELECT = { id: true, supersedesId: true, deletedAt: true, supersededBy: { select: { id: true } } } as const;

function toSuccessors(rows: { id: string; supersedesId: string | null; deletedAt: Date | null; supersededBy: { id: string } | null }[]): Successor[] {
  return rows.flatMap((r) =>
    r.supersedesId ? [{ id: r.id, supersedesId: r.supersedesId, live: r.deletedAt === null, replaced: r.supersededBy !== null }] : [],
  );
}

/** The versions that replaced these ones, in Trash or not. */
async function successorsOf(kind: OwnedDocumentKind, ids: string[]): Promise<Successor[]> {
  const where = { supersedesId: { in: ids } };
  switch (kind) {
    case "CONTRACT":
      return toSuccessors(await prisma.document.findMany({ where, select: SUCCESSOR_SELECT }));
    case "PRODUCT":
      return toSuccessors(await prisma.productDocument.findMany({ where, select: SUCCESSOR_SELECT }));
    case "TRIP_SEGMENT":
      return toSuccessors(await prisma.tripSegmentDocument.findMany({ where, select: SUCCESSOR_SELECT }));
    case "RENTAL_STATEMENT":
      return toSuccessors(await prisma.rentalStatementDocument.findMany({ where, select: SUCCESSOR_SELECT }));
    case "HOME_ITEM":
      return toSuccessors(await prisma.homeItemDocument.findMany({ where, select: SUCCESSOR_SELECT }));
    case "VEHICLE_ITEM":
      return toSuccessors(await prisma.vehicleItemDocument.findMany({ where, select: SUCCESSOR_SELECT }));
    case "INVENTORY_ITEM":
      return toSuccessors(await prisma.inventoryItemDocument.findMany({ where, select: SUCCESSOR_SELECT }));
    case "TRADE":
      return toSuccessors(await prisma.tradeDocument.findMany({ where, select: SUCCESSOR_SELECT }));
  }
}

/**
 * Each Document's latest version: the newest one after it that isn't in
 * Trash, walking past versions that are (as the record page does), or
 * itself when there's none. One query per step along the chains, and none
 * past the last version. A chain that loops back (the app never writes
 * one) leaves each row as its own latest, as the record page lists it.
 */
export async function latestVersionIds(kind: OwnedDocumentKind, ids: string[]): Promise<Map<string, string>> {
  const successor = new Map<string, Successor>();
  const seen = new Set(ids);
  let frontier = ids;
  while (frontier.length > 0) {
    const rows = await successorsOf(kind, frontier);
    frontier = [];
    for (const row of rows) {
      successor.set(row.supersedesId, row);
      if (row.replaced && !seen.has(row.id)) frontier.push(row.id);
      seen.add(row.id);
    }
  }
  const latest = new Map<string, string>();
  for (const id of ids) {
    let head = id;
    const visited = new Set([id]);
    let next = successor.get(id);
    while (next && !visited.has(next.id)) {
      visited.add(next.id);
      if (next.live) head = next.id;
      next = successor.get(next.id);
    }
    latest.set(id, next ? id : head);
  }
  return latest;
}

/**
 * Keeps one hit per Document, from rows already in rank order: the latest
 * version when it's among them, otherwise the best-ranked older version,
 * marked so the result can say so. The order is kept.
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
    // The latest version is among the hits too: it stands for the Document, in its own place.
    if (head !== row.id && matched.has(head)) continue;
    taken.add(head);
    kept.push({ ...row, olderVersion: head !== row.id });
  }
  return kept;
}
