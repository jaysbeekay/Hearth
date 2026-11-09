// Browser-tab titles for record pages (#558, WCAG 2.4.2): each record page
// names its record, so tabs and history entries read "Netflix · Contracts ·
// Hearth" rather than a bare "Hearth". The root layout's title template adds
// the " · Hearth" suffix.
//
// The lookups select one column. A title never names a record the page itself
// would refuse to show: there is no name without a signed-in session (the
// proxy and the (app) layout already redirect, this is the same check again),
// for a record in a disabled module (the page redirects, requireModuleEnabled),
// or for a missing or trashed record (the page 404s).
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
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

/** The opt-in module a record kind belongs to, if any. */
function recordModule(kind: TitledRecord): ModuleKey | null {
  switch (kind) {
    case "trip":
    case "tripSegment":
      return "TRAVEL";
    case "vehicle":
    case "vehicleItem":
      return "VEHICLES";
    case "property":
    case "homeItem":
      return "HOME";
    default:
      return null;
  }
}

/** The nav label each record kind's pages sit under. */
export function recordSection(kind: TitledRecord): string {
  switch (kind) {
    case "contract":
      return "Contracts";
    case "product":
      return "Warranties";
    case "item":
      return "Items";
    case "trip":
    case "tripSegment":
      return MODULE_REGISTRY.TRAVEL.label;
    case "vehicle":
    case "vehicleItem":
      return MODULE_REGISTRY.VEHICLES.label;
    case "property":
    case "homeItem":
      return MODULE_REGISTRY.HOME.label;
  }
}

async function lookupName(kind: TitledRecord, id: string): Promise<string | null> {
  // deletedAt: null, so a trashed record has no name, as its page 404s.
  const select = { where: { id, deletedAt: null } } as const;
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
 * The record's display name, or null when there is no session, the record
 * doesn't exist or is trashed, its module is off, or the name is blank.
 */
export async function recordName(kind: TitledRecord, id: string): Promise<string | null> {
  const session = await auth();
  if (!session?.user) return null;
  const moduleKey = recordModule(kind);
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
  return (name: string) => `${name} · ${recordSection(kind)}`;
}
