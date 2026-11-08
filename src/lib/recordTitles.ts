// Browser-tab titles for record pages (#558, WCAG 2.4.2): each record page
// names its record, so tabs and history entries read "Netflix · Contracts ·
// Hearth" rather than a bare "Hearth". The root layout's title template adds
// the " · Hearth" suffix.
//
// The lookups select one column. A record in a disabled module gets no name,
// so its title can't reveal what the page itself would refuse to show; the
// page then redirects as usual (requireModuleEnabled).
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { isModuleEnabled } from "@/lib/modules/enablement";
import { MODULE_REGISTRY, type ModuleKey } from "@/lib/modules/registry";

export type TitledRecord =
  | "contract"
  | "product"
  | "item"
  | "trip"
  | "tripSegment"
  | "vehicle"
  | "vehicleItem"
  | "property"
  | "homeItem";

const RECORD_MODULE: Partial<Record<TitledRecord, ModuleKey>> = {
  trip: "TRAVEL",
  tripSegment: "TRAVEL",
  vehicle: "VEHICLES",
  vehicleItem: "VEHICLES",
  property: "HOME",
  homeItem: "HOME",
};

/** The nav label each record kind's pages sit under. */
export const RECORD_SECTION: Record<TitledRecord, string> = {
  contract: "Contracts",
  product: "Warranties",
  item: "Items",
  trip: MODULE_REGISTRY.TRAVEL.label,
  tripSegment: MODULE_REGISTRY.TRAVEL.label,
  vehicle: MODULE_REGISTRY.VEHICLES.label,
  vehicleItem: MODULE_REGISTRY.VEHICLES.label,
  property: MODULE_REGISTRY.HOME.label,
  homeItem: MODULE_REGISTRY.HOME.label,
};

async function lookupName(kind: TitledRecord, id: string): Promise<string | null> {
  const select = { where: { id } } as const;
  switch (kind) {
    case "contract":
      return (await prisma.contract.findUnique({ ...select, select: { title: true } }))?.title ?? null;
    case "product":
      return (await prisma.product.findUnique({ ...select, select: { description: true } }))?.description ?? null;
    case "item":
      return (await prisma.item.findUnique({ ...select, select: { description: true } }))?.description ?? null;
    case "trip":
      return (await prisma.trip.findUnique({ ...select, select: { title: true } }))?.title ?? null;
    case "tripSegment":
      return (await prisma.tripSegment.findUnique({ ...select, select: { title: true } }))?.title ?? null;
    case "vehicle":
      return (await prisma.vehicle.findUnique({ ...select, select: { label: true } }))?.label ?? null;
    case "vehicleItem":
      return (await prisma.vehicleItem.findUnique({ ...select, select: { title: true } }))?.title ?? null;
    case "property":
      return (await prisma.property.findUnique({ ...select, select: { label: true } }))?.label ?? null;
    case "homeItem":
      return (await prisma.homeItem.findUnique({ ...select, select: { title: true } }))?.title ?? null;
  }
}

/**
 * The record's display name, or null when it doesn't exist, its module is
 * off, or the name is blank.
 */
export async function recordName(kind: TitledRecord, id: string): Promise<string | null> {
  const moduleKey = RECORD_MODULE[kind];
  if (moduleKey && !(await isModuleEnabled(moduleKey))) return null;
  const name = (await lookupName(kind, id))?.trim();
  return name ? name : null;
}

/**
 * Metadata for a page about one record. `format` builds the title from the
 * record's name; `fallback` is used when there is no name to show.
 *
 *   recordMetadata("contract", id, (name) => `Edit ${name}`, "Edit contract")
 */
export async function recordMetadata(
  kind: TitledRecord,
  id: string,
  format: (name: string) => string,
  fallback: string,
): Promise<Metadata> {
  const name = await recordName(kind, id);
  return { title: name ? format(name) : fallback };
}

/** "Netflix · Contracts": a record's detail page. */
export function detailTitle(kind: TitledRecord) {
  return (name: string) => `${name} · ${RECORD_SECTION[kind]}`;
}
