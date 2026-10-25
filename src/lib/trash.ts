import { prisma } from "@/lib/prisma";
import { purgeVehicle, purgeServiceRecord } from "@/lib/commands/vehicles";
import { purgeContract } from "@/lib/commands/contracts";
import { purgeProduct } from "@/lib/commands/products";
import { purgeDocument, removeOwnerDocumentFiles } from "@/lib/commands/documents";
import { DOCUMENT_KIND_MODULE, type OwnedDocumentKind } from "@/lib/documents/kinds";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";

// #287 — how long a soft-deleted record sits in Trash before it's purged for
// good. No job-runner exists yet (see #250), so this runs opportunistically:
// once whenever the Trash page loads, and once per notification-scheduler
// tick (src/lib/notifications/scheduler.ts) — both already-scheduled,
// low-frequency entry points, so a purge lands within hours of expiring
// rather than needing dedicated cron infrastructure.
export const TRASH_RETENTION_DAYS = 30;

function expiryCutoff(): Date {
  return new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

const expired = (cutoff: Date) => ({ where: { deletedAt: { lt: cutoff } }, select: { id: true } });

// Documents in Trash past their window, every kind (#396). Each is purged
// through the Document command, so its file goes with its row.
async function expiredDocuments(cutoff: Date): Promise<{ kind: OwnedDocumentKind; id: string }[]> {
  const q = expired(cutoff);
  const lists = await Promise.all([
    prisma.document.findMany(q).then((rows) => rows.map((r) => ({ kind: "CONTRACT" as const, id: r.id }))),
    prisma.productDocument.findMany(q).then((rows) => rows.map((r) => ({ kind: "PRODUCT" as const, id: r.id }))),
    prisma.tripSegmentDocument.findMany(q).then((rows) => rows.map((r) => ({ kind: "TRIP_SEGMENT" as const, id: r.id }))),
    prisma.rentalStatementDocument
      .findMany(q)
      .then((rows) => rows.map((r) => ({ kind: "RENTAL_STATEMENT" as const, id: r.id }))),
    prisma.homeItemDocument.findMany(q).then((rows) => rows.map((r) => ({ kind: "HOME_ITEM" as const, id: r.id }))),
    prisma.vehicleItemDocument.findMany(q).then((rows) => rows.map((r) => ({ kind: "VEHICLE_ITEM" as const, id: r.id }))),
    prisma.inventoryItemDocument
      .findMany(q)
      .then((rows) => rows.map((r) => ({ kind: "INVENTORY_ITEM" as const, id: r.id }))),
    prisma.tradeDocument.findMany(q).then((rows) => rows.map((r) => ({ kind: "TRADE" as const, id: r.id }))),
  ]);
  return lists.flat();
}

// Mirrors each domain's permanentlyDeleteX server action (src/lib/actions/*)
// exactly, just without the auth/redirect wrapper a server action needs —
// this runs from a page render and from the scheduler, neither of which is
// "click a button" initiated.
export async function purgeExpiredTrash(): Promise<void> {
  const cutoff = expiryCutoff();

  // Documents first: a Document in Trash under a record that's also expiring
  // would otherwise lose its row to the record's cascade before its own
  // purge, and purgeDocument would report it missing.
  for (const { kind, id } of await expiredDocuments(cutoff)) {
    await purgeDocument(kind, id);
  }

  const [contracts, products, vehicles, properties, trips, inventoryItems, homeItems, vehicleItems] =
    await Promise.all([
      prisma.contract.findMany(expired(cutoff)),
      prisma.product.findMany(expired(cutoff)),
      prisma.vehicle.findMany(expired(cutoff)),
      prisma.property.findMany({
        where: { deletedAt: { lt: cutoff } },
        select: { id: true, items: { select: { id: true } }, rentalStatements: { select: { id: true } } },
      }),
      prisma.trip.findMany({
        where: { deletedAt: { lt: cutoff } },
        select: { id: true, segments: { select: { id: true } } },
      }),
      prisma.inventoryItem.findMany(expired(cutoff)),
      prisma.homeItem.findMany(expired(cutoff)),
      prisma.vehicleItem.findMany(expired(cutoff)),
    ]);

  for (const i of homeItems) {
    await removeOwnerDocumentFiles("HOME_ITEM", i.id);
    await prisma.homeItem.delete({ where: { id: i.id } });
  }
  for (const i of vehicleItems) {
    await purgeServiceRecord(i.id);
  }
  for (const c of contracts) {
    await purgeContract(c.id);
  }
  for (const p of products) {
    await purgeProduct(p.id);
  }
  for (const v of vehicles) {
    await purgeVehicle(v.id);
  }
  for (const p of properties) {
    for (const item of p.items) await removeOwnerDocumentFiles("HOME_ITEM", item.id);
    for (const statement of p.rentalStatements) await removeOwnerDocumentFiles("RENTAL_STATEMENT", statement.id);
    await prisma.property.delete({ where: { id: p.id } });
  }
  for (const t of trips) {
    for (const segment of t.segments) await removeOwnerDocumentFiles("TRIP_SEGMENT", segment.id);
    await prisma.trip.delete({ where: { id: t.id } });
  }
  for (const i of inventoryItems) {
    await removeOwnerDocumentFiles("INVENTORY_ITEM", i.id);
    await prisma.inventoryItem.delete({ where: { id: i.id } });
  }
}

export interface TrashEntry {
  id: string;
  domain:
    | "contract"
    | "product"
    | "vehicle"
    | "property"
    | "trip"
    | "inventoryItem"
    | "homeItem"
    | "vehicleItem"
    | "document";
  /** Set when domain is "document": which kind of Document it is. */
  documentKind?: OwnedDocumentKind;
  label: string;
  subtitle: string | null;
  deletedAt: Date;
}

const inTrash = { where: { deletedAt: { not: null } } } as const;

// Every Document in Trash, whatever it's attached to (#396), except those
// of a module that's turned off: they can't be restored or deleted until
// it's back on (they're still purged when their 30 days run out). The
// subtitle names the record it was attached to.
async function trashedDocuments(): Promise<TrashEntry[]> {
  const enabled = await getEnabledModuleKeys();
  const visible = (kind: OwnedDocumentKind) => {
    const key = DOCUMENT_KIND_MODULE[kind];
    return key === null || enabled.has(key);
  };
  const base = { id: true, filename: true, deletedAt: true } as const;
  const entry = (kind: OwnedDocumentKind, d: { id: string; filename: string; deletedAt: Date | null }, subtitle: string | null): TrashEntry => ({
    id: d.id,
    domain: "document",
    documentKind: kind,
    label: d.filename,
    subtitle,
    deletedAt: d.deletedAt!,
  });

  const lists = await Promise.all([
    prisma.document
      .findMany({ ...inTrash, select: { ...base, contract: { select: { title: true } } } })
      .then((rows) => rows.map((d) => entry("CONTRACT", d, d.contract.title))),
    prisma.productDocument
      .findMany({ ...inTrash, select: { ...base, product: { select: { description: true } } } })
      .then((rows) => rows.map((d) => entry("PRODUCT", d, d.product.description))),
    prisma.tripSegmentDocument
      .findMany({
        ...inTrash,
        select: { ...base, tripSegment: { select: { title: true, trip: { select: { title: true } } } } },
      })
      .then((rows) => rows.map((d) => entry("TRIP_SEGMENT", d, `${d.tripSegment.trip.title} · ${d.tripSegment.title}`))),
    prisma.rentalStatementDocument
      .findMany({
        ...inTrash,
        select: { ...base, rentalStatement: { select: { property: { select: { label: true } } } } },
      })
      .then((rows) => rows.map((d) => entry("RENTAL_STATEMENT", d, d.rentalStatement.property.label))),
    prisma.homeItemDocument
      .findMany({ ...inTrash, select: { ...base, homeItem: { select: { title: true } } } })
      .then((rows) => rows.map((d) => entry("HOME_ITEM", d, d.homeItem.title))),
    prisma.vehicleItemDocument
      .findMany({ ...inTrash, select: { ...base, vehicleItem: { select: { title: true } } } })
      .then((rows) => rows.map((d) => entry("VEHICLE_ITEM", d, d.vehicleItem.title))),
    prisma.inventoryItemDocument
      .findMany({ ...inTrash, select: { ...base, inventoryItem: { select: { label: true } } } })
      .then((rows) => rows.map((d) => entry("INVENTORY_ITEM", d, d.inventoryItem.label))),
    prisma.tradeDocument
      .findMany({ ...inTrash, select: { ...base, trade: { select: { holding: { select: { ticker: true } } } } } })
      .then((rows) => rows.map((d) => entry("TRADE", d, d.trade.holding.ticker))),
  ]);
  return lists.flat().filter((entry) => visible(entry.documentKind!));
}

// Everything currently in Trash, for the Settings > Trash page — run after
// purgeExpiredTrash() so nothing already past its window shows as "restorable".
export async function getTrashEntries(): Promise<TrashEntry[]> {
  const [contracts, products, vehicles, properties, trips, inventoryItems, homeItems, vehicleItems, documents] =
    await Promise.all([
      prisma.contract.findMany({
        ...inTrash,
        select: { id: true, title: true, provider: true, deletedAt: true },
      }),
      prisma.product.findMany({
        ...inTrash,
        select: { id: true, description: true, manufacturer: true, deletedAt: true },
      }),
      prisma.vehicle.findMany({
        ...inTrash,
        select: { id: true, label: true, make: true, model: true, deletedAt: true },
      }),
      prisma.property.findMany({
        ...inTrash,
        select: { id: true, label: true, deletedAt: true },
      }),
      prisma.trip.findMany({
        ...inTrash,
        select: { id: true, title: true, destination: true, deletedAt: true },
      }),
      prisma.inventoryItem.findMany({
        ...inTrash,
        select: { id: true, label: true, brand: true, deletedAt: true },
      }),
      prisma.homeItem.findMany({
        ...inTrash,
        select: { id: true, title: true, property: { select: { label: true } }, deletedAt: true },
      }),
      prisma.vehicleItem.findMany({
        ...inTrash,
        select: { id: true, title: true, vehicle: { select: { label: true } }, deletedAt: true },
      }),
      trashedDocuments(),
    ]);

  const entries: TrashEntry[] = [
    ...contracts.map((c) => ({
      id: c.id,
      domain: "contract" as const,
      label: c.title,
      subtitle: c.provider,
      deletedAt: c.deletedAt!,
    })),
    ...products.map((p) => ({
      id: p.id,
      domain: "product" as const,
      label: p.description,
      subtitle: p.manufacturer,
      deletedAt: p.deletedAt!,
    })),
    ...vehicles.map((v) => ({
      id: v.id,
      domain: "vehicle" as const,
      label: v.label,
      subtitle: [v.make, v.model].filter(Boolean).join(" ") || null,
      deletedAt: v.deletedAt!,
    })),
    ...properties.map((p) => ({
      id: p.id,
      domain: "property" as const,
      label: p.label,
      subtitle: null,
      deletedAt: p.deletedAt!,
    })),
    ...trips.map((t) => ({
      id: t.id,
      domain: "trip" as const,
      label: t.title,
      subtitle: t.destination,
      deletedAt: t.deletedAt!,
    })),
    ...inventoryItems.map((i) => ({
      id: i.id,
      domain: "inventoryItem" as const,
      label: i.label,
      subtitle: i.brand,
      deletedAt: i.deletedAt!,
    })),
    ...homeItems.map((i) => ({
      id: i.id,
      domain: "homeItem" as const,
      label: i.title,
      subtitle: i.property.label,
      deletedAt: i.deletedAt!,
    })),
    ...vehicleItems.map((i) => ({
      id: i.id,
      domain: "vehicleItem" as const,
      label: i.title,
      subtitle: i.vehicle.label,
      deletedAt: i.deletedAt!,
    })),
    ...documents,
  ];

  return entries.sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());
}
