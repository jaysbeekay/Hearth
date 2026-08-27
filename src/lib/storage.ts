import path from "path";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { DocumentStore, registerReconcileTarget } from "@/lib/documentStore";

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

export async function saveDocument(contractId: string, file: File) {
  return contractStore.save(contractId, file);
}
export async function readDocument(contractId: string, storedName: string) {
  return contractStore.read(contractId, storedName);
}
export async function deleteDocument(contractId: string, storedName: string) {
  return contractStore.remove(contractId, storedName);
}
export async function deleteContractDir(contractId: string) {
  return contractStore.removeAll(contractId);
}

export async function saveProductDocument(productId: string, file: File) {
  return productStore.save(productId, file);
}
export async function readProductDocument(productId: string, storedName: string) {
  return productStore.read(productId, storedName);
}
export async function deleteProductDocument(productId: string, storedName: string) {
  return productStore.remove(productId, storedName);
}
export async function deleteProductDir(productId: string) {
  return productStore.removeAll(productId);
}

export async function saveTripSegmentDocument(tripSegmentId: string, file: File) {
  return tripSegmentStore.save(tripSegmentId, file);
}
export async function readTripSegmentDocument(tripSegmentId: string, storedName: string) {
  return tripSegmentStore.read(tripSegmentId, storedName);
}
export async function deleteTripSegmentDocument(tripSegmentId: string, storedName: string) {
  return tripSegmentStore.remove(tripSegmentId, storedName);
}
export async function deleteTripSegmentDir(tripSegmentId: string) {
  return tripSegmentStore.removeAll(tripSegmentId);
}

export async function saveHomeItemDocument(homeItemId: string, file: File) {
  return homeItemStore.save(homeItemId, file);
}
export async function readHomeItemDocument(homeItemId: string, storedName: string) {
  return homeItemStore.read(homeItemId, storedName);
}
export async function deleteHomeItemDocument(homeItemId: string, storedName: string) {
  return homeItemStore.remove(homeItemId, storedName);
}
export async function deleteHomeItemDir(homeItemId: string) {
  return homeItemStore.removeAll(homeItemId);
}

export async function saveVehicleItemDocument(vehicleItemId: string, file: File) {
  return vehicleItemStore.save(vehicleItemId, file);
}
export async function readVehicleItemDocument(vehicleItemId: string, storedName: string) {
  return vehicleItemStore.read(vehicleItemId, storedName);
}
export async function deleteVehicleItemDocument(vehicleItemId: string, storedName: string) {
  return vehicleItemStore.remove(vehicleItemId, storedName);
}
export async function deleteVehicleItemDir(vehicleItemId: string) {
  return vehicleItemStore.removeAll(vehicleItemId);
}

export async function saveRentalStatementDocument(statementId: string, file: File) {
  return rentalStatementStore.save(statementId, file);
}
export async function readRentalStatementDocument(statementId: string, storedName: string) {
  return rentalStatementStore.read(statementId, storedName);
}
export async function deleteRentalStatementDocument(statementId: string, storedName: string) {
  return rentalStatementStore.remove(statementId, storedName);
}
export async function deleteRentalStatementDir(statementId: string) {
  return rentalStatementStore.removeAll(statementId);
}

export async function saveInventoryItemDocument(inventoryItemId: string, file: File) {
  return inventoryItemStore.save(inventoryItemId, file);
}
export async function readInventoryItemDocument(inventoryItemId: string, storedName: string) {
  return inventoryItemStore.read(inventoryItemId, storedName);
}
export async function deleteInventoryItemDocument(inventoryItemId: string, storedName: string) {
  return inventoryItemStore.remove(inventoryItemId, storedName);
}
export async function deleteInventoryItemDir(inventoryItemId: string) {
  return inventoryItemStore.removeAll(inventoryItemId);
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

export async function saveTradeDocument(tradeId: string, file: File) {
  return tradeStore.save(tradeId, file);
}
export async function readTradeDocument(tradeId: string, storedName: string) {
  return tradeStore.read(tradeId, storedName);
}
export async function deleteTradeDocument(tradeId: string, storedName: string) {
  return tradeStore.remove(tradeId, storedName);
}
export async function deleteTradeDir(tradeId: string) {
  return tradeStore.removeAll(tradeId);
}
