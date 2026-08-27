import { prisma } from "@/lib/prisma";
import { clearNotificationLogs } from "@/lib/notifications/logs";
import {
  deleteContractDir,
  deleteProductDir,
  deleteVehicleItemDir,
  deleteHomeItemDir,
  deleteTripSegmentDir,
  deleteInventoryItemDir,
} from "@/lib/storage";

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

// Mirrors each domain's permanentlyDeleteX server action (src/lib/actions/*)
// exactly, just without the auth/redirect wrapper a server action needs —
// this runs from a page render and from the scheduler, neither of which is
// "click a button" initiated.
export async function purgeExpiredTrash(): Promise<void> {
  const cutoff = expiryCutoff();

  const [contracts, products, vehicles, properties, trips, inventoryItems] = await Promise.all([
    prisma.contract.findMany({ where: { deletedAt: { lt: cutoff } }, select: { id: true } }),
    prisma.product.findMany({ where: { deletedAt: { lt: cutoff } }, select: { id: true } }),
    prisma.vehicle.findMany({
      where: { deletedAt: { lt: cutoff } },
      select: { id: true, items: { select: { id: true } } },
    }),
    prisma.property.findMany({
      where: { deletedAt: { lt: cutoff } },
      select: { id: true, items: { select: { id: true } } },
    }),
    prisma.trip.findMany({
      where: { deletedAt: { lt: cutoff } },
      select: { id: true, segments: { select: { id: true } } },
    }),
    prisma.inventoryItem.findMany({ where: { deletedAt: { lt: cutoff } }, select: { id: true } }),
  ]);

  for (const c of contracts) {
    await prisma.contract.delete({ where: { id: c.id } });
    await clearNotificationLogs("CONTRACT", c.id);
    await deleteContractDir(c.id);
  }
  for (const p of products) {
    await prisma.product.delete({ where: { id: p.id } });
    await clearNotificationLogs("PRODUCT", p.id);
    await deleteProductDir(p.id);
  }
  for (const v of vehicles) {
    for (const item of v.items) await deleteVehicleItemDir(item.id);
    await prisma.vehicle.delete({ where: { id: v.id } });
    await clearNotificationLogs("VEHICLE", v.id);
  }
  for (const p of properties) {
    for (const item of p.items) await deleteHomeItemDir(item.id);
    await prisma.property.delete({ where: { id: p.id } });
  }
  for (const t of trips) {
    for (const segment of t.segments) await deleteTripSegmentDir(segment.id);
    await prisma.trip.delete({ where: { id: t.id } });
  }
  for (const i of inventoryItems) {
    await deleteInventoryItemDir(i.id);
    await prisma.inventoryItem.delete({ where: { id: i.id } });
  }
}

export interface TrashEntry {
  id: string;
  domain: "contract" | "product" | "vehicle" | "property" | "trip" | "inventoryItem";
  label: string;
  subtitle: string | null;
  deletedAt: Date;
}

// Everything currently in Trash, for the Settings > Trash page — run after
// purgeExpiredTrash() so nothing already past its window shows as "restorable".
export async function getTrashEntries(): Promise<TrashEntry[]> {
  const [contracts, products, vehicles, properties, trips, inventoryItems] = await Promise.all([
    prisma.contract.findMany({
      where: { deletedAt: { not: null } },
      select: { id: true, title: true, provider: true, deletedAt: true },
    }),
    prisma.product.findMany({
      where: { deletedAt: { not: null } },
      select: { id: true, description: true, manufacturer: true, deletedAt: true },
    }),
    prisma.vehicle.findMany({
      where: { deletedAt: { not: null } },
      select: { id: true, label: true, make: true, model: true, deletedAt: true },
    }),
    prisma.property.findMany({
      where: { deletedAt: { not: null } },
      select: { id: true, label: true, deletedAt: true },
    }),
    prisma.trip.findMany({
      where: { deletedAt: { not: null } },
      select: { id: true, title: true, destination: true, deletedAt: true },
    }),
    prisma.inventoryItem.findMany({
      where: { deletedAt: { not: null } },
      select: { id: true, label: true, brand: true, deletedAt: true },
    }),
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
  ];

  return entries.sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());
}
