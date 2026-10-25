import type { ModuleKey } from "@/lib/modules/registry";

// Client-safe facts about Document kinds (#396): no Prisma, no storage, so
// list components and the offline queue can import them too.

/** Every Document table, keyed by the record type it's attached to. INBOX is a location, not an owner. */
export type DocumentKind =
  | "CONTRACT"
  | "PRODUCT"
  | "TRIP_SEGMENT"
  | "RENTAL_STATEMENT"
  | "HOME_ITEM"
  | "VEHICLE_ITEM"
  | "INVENTORY_ITEM"
  | "TRADE"
  | "INBOX";

/** A Document attached to a record: everything but the Inbox. */
export type OwnedDocumentKind = Exclude<DocumentKind, "INBOX">;

export const OWNED_DOCUMENT_KINDS = [
  "CONTRACT",
  "PRODUCT",
  "TRIP_SEGMENT",
  "RENTAL_STATEMENT",
  "HOME_ITEM",
  "VEHICLE_ITEM",
  "INVENTORY_ITEM",
  "TRADE",
] as const satisfies readonly OwnedDocumentKind[];

export function isOwnedDocumentKind(value: unknown): value is OwnedDocumentKind {
  return typeof value === "string" && (OWNED_DOCUMENT_KINDS as readonly string[]).includes(value);
}

/** The opt-in module a kind belongs to; null for the always-on Contracts and Products. */
export const DOCUMENT_KIND_MODULE: Record<OwnedDocumentKind, ModuleKey | null> = {
  CONTRACT: null,
  PRODUCT: null,
  TRIP_SEGMENT: "TRAVEL",
  RENTAL_STATEMENT: "HOME",
  HOME_ITEM: "HOME",
  VEHICLE_ITEM: "VEHICLES",
  INVENTORY_ITEM: "INVENTORY",
  TRADE: "WEALTH",
};

/** What a Document of this kind is called in Trash, in glossary terms. */
export const DOCUMENT_KIND_LABEL: Record<OwnedDocumentKind, string> = {
  CONTRACT: "Contract document",
  PRODUCT: "Warranty document",
  TRIP_SEGMENT: "Trip segment document",
  RENTAL_STATEMENT: "Rental statement document",
  HOME_ITEM: "Maintenance record document",
  VEHICLE_ITEM: "Service record document",
  INVENTORY_ITEM: "Inventory document",
  TRADE: "Trade document",
};

/** The one file route for every kind; the id alone identifies the Document. */
export function documentFileHref(id: string) {
  return `/api/documents/${id}`;
}

// The sync entity names used before #396, one per kind. Ops queued offline
// before the upgrade still carry these and are mapped onto the `document`
// entity. For tradeDocument the queued parentId was the Holding, not the
// Trade, so it can't be used as the owner scope.
export const LEGACY_DOCUMENT_SYNC_ENTITIES: Record<string, { kind: OwnedDocumentKind; parentIsOwner: boolean }> = {
  contractDocument: { kind: "CONTRACT", parentIsOwner: true },
  productDocument: { kind: "PRODUCT", parentIsOwner: true },
  tripSegmentDocument: { kind: "TRIP_SEGMENT", parentIsOwner: true },
  rentalStatementDocument: { kind: "RENTAL_STATEMENT", parentIsOwner: true },
  homeItemDocument: { kind: "HOME_ITEM", parentIsOwner: true },
  vehicleItemDocument: { kind: "VEHICLE_ITEM", parentIsOwner: true },
  inventoryItemDocument: { kind: "INVENTORY_ITEM", parentIsOwner: true },
  tradeDocument: { kind: "TRADE", parentIsOwner: false },
};

// The per-module file URLs used before #396. They now redirect to
// documentFileHref; offline copies saved under them are still looked up.
export const LEGACY_DOCUMENT_FILE_PREFIXES = [
  "/api/products/documents/",
  "/api/home/documents/",
  "/api/home/rental-documents/",
  "/api/inventory/documents/",
  "/api/travel/documents/",
  "/api/vehicles/documents/",
  "/api/wealth/trade-documents/",
] as const;
