import { prisma } from "@/lib/prisma";
import { purgeVehicle, purgeServiceRecord } from "@/lib/commands/vehicles";
import { purgeContract } from "@/lib/commands/contracts";
import { purgeProduct } from "@/lib/commands/products";
import { purgeTrip, purgeTripSegment } from "@/lib/commands/trips";
import {
  purgeProperty,
  purgeMaintenanceRecord,
  purgeTenancy,
  purgeRentalStatement,
  purgePropertyValuation,
} from "@/lib/commands/home";
import { purgeTrade } from "@/lib/commands/wealth";
import { formatCurrency, formatDate } from "@/lib/utils";
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
      prisma.property.findMany(expired(cutoff)),
      prisma.trip.findMany(expired(cutoff)),
      prisma.inventoryItem.findMany(expired(cutoff)),
      prisma.homeItem.findMany(expired(cutoff)),
      prisma.vehicleItem.findMany(expired(cutoff)),
    ]);
  const [tripSegments, rentalStatements, tenancies, valuations, trades] = await Promise.all([
    prisma.tripSegment.findMany(expired(cutoff)),
    prisma.rentalStatement.findMany(expired(cutoff)),
    prisma.rentalAgreement.findMany(expired(cutoff)),
    prisma.propertyValuation.findMany(expired(cutoff)),
    prisma.trade.findMany(expired(cutoff)),
  ]);

  // Records under a parent before the parents, for the same reason as
  // Documents first: a parent's cascade would take the child's row first.
  for (const i of homeItems) {
    await purgeMaintenanceRecord(i.id);
  }
  for (const i of vehicleItems) {
    await purgeServiceRecord(i.id);
  }
  for (const s of tripSegments) {
    await purgeTripSegment(s.id);
  }
  for (const s of rentalStatements) {
    await purgeRentalStatement(s.id);
  }
  for (const t of tenancies) {
    await purgeTenancy(t.id);
  }
  for (const v of valuations) {
    await purgePropertyValuation(v.id);
  }
  for (const t of trades) {
    await purgeTrade(t.id);
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
    await purgeProperty(p.id);
  }
  for (const t of trips) {
    await purgeTrip(t.id);
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
    | "tripSegment"
    | "rentalStatement"
    | "tenancy"
    | "propertyValuation"
    | "trade"
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

function tradeTypeLabel(type: string): string {
  switch (type) {
    case "SELL":
      return "Sell";
    case "DIVIDEND":
      return "Dividend";
    case "SPLIT":
      return "Split";
    default:
      return "Buy";
  }
}

// The entries of a record that go to Trash on their own (#427): Trip
// segments, Rental statements, Tenancies, Property valuations and Trades.
// Each is labelled by what it is and subtitled with the record it's under.
async function trashedEntries(dateFormat?: string | null): Promise<TrashEntry[]> {
  const [segments, statements, tenancies, valuations, trades] = await Promise.all([
    prisma.tripSegment.findMany({
      ...inTrash,
      select: { id: true, title: true, trip: { select: { title: true } }, deletedAt: true },
    }),
    prisma.rentalStatement.findMany({
      ...inTrash,
      select: {
        id: true,
        statementDate: true,
        periodStart: true,
        periodEnd: true,
        property: { select: { label: true } },
        deletedAt: true,
      },
    }),
    prisma.rentalAgreement.findMany({
      ...inTrash,
      select: { id: true, tenantName: true, property: { select: { label: true } }, deletedAt: true },
    }),
    prisma.propertyValuation.findMany({
      ...inTrash,
      select: { id: true, value: true, currency: true, valuedAt: true, property: { select: { label: true } }, deletedAt: true },
    }),
    prisma.trade.findMany({
      ...inTrash,
      select: { id: true, type: true, units: true, date: true, holding: { select: { ticker: true } }, deletedAt: true },
    }),
  ]);

  return [
    ...segments.map((s) => ({
      id: s.id,
      domain: "tripSegment" as const,
      label: s.title,
      subtitle: s.trip.title,
      deletedAt: s.deletedAt!,
    })),
    ...statements.map((s) => {
      const date = s.statementDate ?? s.periodEnd ?? s.periodStart;
      return {
        id: s.id,
        domain: "rentalStatement" as const,
        label: date ? `Statement ${formatDate(date, dateFormat)}` : "Statement",
        subtitle: s.property.label,
        deletedAt: s.deletedAt!,
      };
    }),
    ...tenancies.map((t) => ({
      id: t.id,
      domain: "tenancy" as const,
      label: t.tenantName ?? "Tenancy",
      subtitle: t.property.label,
      deletedAt: t.deletedAt!,
    })),
    ...valuations.map((v) => ({
      id: v.id,
      domain: "propertyValuation" as const,
      label: `${formatCurrency(v.value, v.currency)} on ${formatDate(v.valuedAt, dateFormat)}`,
      subtitle: v.property.label,
      deletedAt: v.deletedAt!,
    })),
    ...trades.map((t) => ({
      id: t.id,
      domain: "trade" as const,
      label: `${tradeTypeLabel(t.type)} ${t.units} ${t.holding.ticker}`,
      subtitle: formatDate(t.date, dateFormat),
      deletedAt: t.deletedAt!,
    })),
  ];
}

// Everything currently in Trash, for the Settings > Trash page — run after
// purgeExpiredTrash() so nothing already past its window shows as "restorable".
// `dateFormat` is the viewer's, for the dates some labels carry.
export async function getTrashEntries(dateFormat?: string | null): Promise<TrashEntry[]> {
  const [contracts, products, vehicles, properties, trips, inventoryItems, homeItems, vehicleItems, documents, recordEntries] =
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
      trashedEntries(dateFormat),
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
    ...recordEntries,
    ...documents,
  ];

  return entries.sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());
}
