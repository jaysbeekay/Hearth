import path from "path";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { DocumentStore, registerReconcileTarget } from "@/lib/documentStore";
import type { OwnedDocumentKind } from "@/lib/documents/kinds";

export { MAX_UPLOAD_BYTES, ALLOWED_MIME_TYPES } from "@/lib/uploadLimits";

// IDs are always database-sourced cuids, but path.basename() strips any
// directory-traversal characters defensively in case that ever changes.
function contractDir(contractId: string) {
  return path.join(path.resolve(env.uploadsDir), path.basename(contractId));
}

function productDir(productId: string) {
  return path.join(path.resolve(env.uploadsDir), "products", path.basename(productId));
}

function tripSegmentDir(tripSegmentId: string) {
  return path.join(path.resolve(env.uploadsDir), "trip-segments", path.basename(tripSegmentId));
}

function homeItemDir(homeItemId: string) {
  return path.join(path.resolve(env.uploadsDir), "home-items", path.basename(homeItemId));
}

function vehicleItemDir(vehicleItemId: string) {
  return path.join(path.resolve(env.uploadsDir), "vehicle-items", path.basename(vehicleItemId));
}

function rentalStatementDir(statementId: string) {
  return path.join(path.resolve(env.uploadsDir), "rental-statements", path.basename(statementId));
}

function inventoryItemDir(inventoryItemId: string) {
  return path.join(path.resolve(env.uploadsDir), "inventory-items", path.basename(inventoryItemId));
}

function inboxDir() {
  return path.join(path.resolve(env.uploadsDir), "inbox");
}

function tradeDir(tradeId: string) {
  return path.join(path.resolve(env.uploadsDir), "trades", path.basename(tradeId));
}

const contractStore = new DocumentStore(contractDir);
const productStore = new DocumentStore(productDir);
const tripSegmentStore = new DocumentStore(tripSegmentDir);
const homeItemStore = new DocumentStore(homeItemDir);
const vehicleItemStore = new DocumentStore(vehicleItemDir);
const rentalStatementStore = new DocumentStore(rentalStatementDir);
const inventoryItemStore = new DocumentStore(inventoryItemDir);
const inboxStore = new DocumentStore(inboxDir);
const tradeStore = new DocumentStore(tradeDir);

// #396 — the Document command (src/lib/commands/documents.ts) works by kind,
// so it reaches each kind's files through this map rather than the per-kind
// save*/delete* wrappers below.
const STORE_BY_KIND: Record<OwnedDocumentKind, DocumentStore> = {
  CONTRACT: contractStore,
  PRODUCT: productStore,
  TRIP_SEGMENT: tripSegmentStore,
  RENTAL_STATEMENT: rentalStatementStore,
  HOME_ITEM: homeItemStore,
  VEHICLE_ITEM: vehicleItemStore,
  INVENTORY_ITEM: inventoryItemStore,
  TRADE: tradeStore,
};

export function documentStoreFor(kind: OwnedDocumentKind): DocumentStore {
  return STORE_BY_KIND[kind];
}

// #251 — one reconciliation sweep, registered once per kind, covers every
// domain's file storage uniformly. See documentStore.ts for what it checks.
registerReconcileTarget({
  kind: "contract",
  store: contractStore,
  parentDir: path.resolve(env.uploadsDir),
  flat: false,
  listOwnerDocuments: (ownerId) =>
    prisma.document.findMany({ where: { contractId: ownerId }, select: { storedName: true } }),
});
registerReconcileTarget({
  kind: "product",
  store: productStore,
  parentDir: path.join(path.resolve(env.uploadsDir), "products"),
  flat: false,
  listOwnerDocuments: (ownerId) =>
    prisma.productDocument.findMany({ where: { productId: ownerId }, select: { storedName: true } }),
});
registerReconcileTarget({
  kind: "tripSegment",
  store: tripSegmentStore,
  parentDir: path.join(path.resolve(env.uploadsDir), "trip-segments"),
  flat: false,
  listOwnerDocuments: (ownerId) =>
    prisma.tripSegmentDocument.findMany({ where: { tripSegmentId: ownerId }, select: { storedName: true } }),
});
registerReconcileTarget({
  kind: "homeItem",
  store: homeItemStore,
  parentDir: path.join(path.resolve(env.uploadsDir), "home-items"),
  flat: false,
  listOwnerDocuments: (ownerId) =>
    prisma.homeItemDocument.findMany({ where: { homeItemId: ownerId }, select: { storedName: true } }),
});
registerReconcileTarget({
  kind: "vehicleItem",
  store: vehicleItemStore,
  parentDir: path.join(path.resolve(env.uploadsDir), "vehicle-items"),
  flat: false,
  listOwnerDocuments: (ownerId) =>
    prisma.vehicleItemDocument.findMany({ where: { vehicleItemId: ownerId }, select: { storedName: true } }),
});
registerReconcileTarget({
  kind: "rentalStatement",
  store: rentalStatementStore,
  parentDir: path.join(path.resolve(env.uploadsDir), "rental-statements"),
  flat: false,
  listOwnerDocuments: (ownerId) =>
    prisma.rentalStatementDocument.findMany({
      where: { rentalStatementId: ownerId },
      select: { storedName: true },
    }),
});
registerReconcileTarget({
  kind: "inventoryItem",
  store: inventoryItemStore,
  parentDir: path.join(path.resolve(env.uploadsDir), "inventory-items"),
  flat: false,
  listOwnerDocuments: (ownerId) =>
    prisma.inventoryItemDocument.findMany({
      where: { inventoryItemId: ownerId },
      select: { storedName: true },
    }),
});
registerReconcileTarget({
  kind: "trade",
  store: tradeStore,
  parentDir: path.join(path.resolve(env.uploadsDir), "trades"),
  flat: false,
  listOwnerDocuments: (ownerId) =>
    prisma.tradeDocument.findMany({ where: { tradeId: ownerId }, select: { storedName: true } }),
});
registerReconcileTarget({
  kind: "inbox",
  store: inboxStore,
  parentDir: path.join(path.resolve(env.uploadsDir), "inbox"),
  flat: true,
  listOwnerDocuments: () => prisma.inboxDocument.findMany({ select: { storedName: true } }),
});

// Writes to an owned Document go through the Document command, via
// documentStoreFor. What's left here: the reads the extraction job uses,
// and the Inbox, which has no owner record.
export async function readDocument(contractId: string, storedName: string) {
  return contractStore.read(contractId, storedName);
}
export async function readProductDocument(productId: string, storedName: string) {
  return productStore.read(productId, storedName);
}
export async function saveInboxDocument(file: File) {
  return inboxStore.save("", file);
}
export async function readInboxDocument(storedName: string) {
  return inboxStore.read("", storedName);
}
export async function deleteInboxDocument(storedName: string) {
  return inboxStore.remove("", storedName);
}

