import { randomUUID } from "crypto";
import path from "path";
import fs from "fs/promises";
import { env } from "@/lib/env";

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

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

// storedName is always a freshly generated UUID plus a sanitized extension,
// never derived from the user-supplied filename, to avoid path traversal.
function safeExtension(filename: string) {
  const ext = path.extname(filename).toLowerCase().replace(/[^a-z0-9.]/g, "");
  return ext.length > 0 && ext.length <= 10 ? ext : "";
}

export async function saveDocument(contractId: string, file: File) {
  const dir = contractDir(contractId);
  await fs.mkdir(dir, { recursive: true });

  const storedName = `${randomUUID()}${safeExtension(file.name)}`;
  const fullPath = path.join(dir, storedName);

  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(fullPath, buffer);

  return { storedName, size: buffer.byteLength };
}

export async function readDocument(contractId: string, storedName: string) {
  const fullPath = path.join(contractDir(contractId), storedName);
  return fs.readFile(fullPath);
}

export async function deleteDocument(contractId: string, storedName: string) {
  const fullPath = path.join(contractDir(contractId), storedName);
  await fs.rm(fullPath, { force: true });
}

export async function deleteContractDir(contractId: string) {
  await fs.rm(contractDir(contractId), { recursive: true, force: true });
}

export async function saveProductDocument(productId: string, file: File) {
  const dir = productDir(productId);
  await fs.mkdir(dir, { recursive: true });

  const storedName = `${randomUUID()}${safeExtension(file.name)}`;
  const fullPath = path.join(dir, storedName);

  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(fullPath, buffer);

  return { storedName, size: buffer.byteLength };
}

export async function readProductDocument(productId: string, storedName: string) {
  const fullPath = path.join(productDir(productId), storedName);
  return fs.readFile(fullPath);
}

export async function deleteProductDocument(productId: string, storedName: string) {
  const fullPath = path.join(productDir(productId), storedName);
  await fs.rm(fullPath, { force: true });
}

export async function deleteProductDir(productId: string) {
  await fs.rm(productDir(productId), { recursive: true, force: true });
}

export async function saveTripSegmentDocument(tripSegmentId: string, file: File) {
  const dir = tripSegmentDir(tripSegmentId);
  await fs.mkdir(dir, { recursive: true });

  const storedName = `${randomUUID()}${safeExtension(file.name)}`;
  const fullPath = path.join(dir, storedName);

  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(fullPath, buffer);

  return { storedName, size: buffer.byteLength };
}

export async function readTripSegmentDocument(tripSegmentId: string, storedName: string) {
  const fullPath = path.join(tripSegmentDir(tripSegmentId), storedName);
  return fs.readFile(fullPath);
}

export async function deleteTripSegmentDocument(tripSegmentId: string, storedName: string) {
  const fullPath = path.join(tripSegmentDir(tripSegmentId), storedName);
  await fs.rm(fullPath, { force: true });
}

export async function deleteTripSegmentDir(tripSegmentId: string) {
  await fs.rm(tripSegmentDir(tripSegmentId), { recursive: true, force: true });
}

export async function saveHomeItemDocument(homeItemId: string, file: File) {
  const dir = homeItemDir(homeItemId);
  await fs.mkdir(dir, { recursive: true });

  const storedName = `${randomUUID()}${safeExtension(file.name)}`;
  const fullPath = path.join(dir, storedName);

  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(fullPath, buffer);

  return { storedName, size: buffer.byteLength };
}

export async function readHomeItemDocument(homeItemId: string, storedName: string) {
  const fullPath = path.join(homeItemDir(homeItemId), storedName);
  return fs.readFile(fullPath);
}

export async function deleteHomeItemDocument(homeItemId: string, storedName: string) {
  const fullPath = path.join(homeItemDir(homeItemId), storedName);
  await fs.rm(fullPath, { force: true });
}

export async function deleteHomeItemDir(homeItemId: string) {
  await fs.rm(homeItemDir(homeItemId), { recursive: true, force: true });
}

function vehicleItemDir(vehicleItemId: string) {
  return path.join(path.resolve(env.uploadsDir), "vehicle-items", path.basename(vehicleItemId));
}

export async function saveVehicleItemDocument(vehicleItemId: string, file: File) {
  const dir = vehicleItemDir(vehicleItemId);
  await fs.mkdir(dir, { recursive: true });

  const storedName = `${randomUUID()}${safeExtension(file.name)}`;
  const fullPath = path.join(dir, storedName);

  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(fullPath, buffer);

  return { storedName, size: buffer.byteLength };
}

export async function readVehicleItemDocument(vehicleItemId: string, storedName: string) {
  const fullPath = path.join(vehicleItemDir(vehicleItemId), storedName);
  return fs.readFile(fullPath);
}

export async function deleteVehicleItemDocument(vehicleItemId: string, storedName: string) {
  const fullPath = path.join(vehicleItemDir(vehicleItemId), storedName);
  await fs.rm(fullPath, { force: true });
}

export async function deleteVehicleItemDir(vehicleItemId: string) {
  await fs.rm(vehicleItemDir(vehicleItemId), { recursive: true, force: true });
}

function rentalStatementDir(statementId: string) {
  return path.join(
    path.resolve(env.uploadsDir),
    "rental-statements",
    path.basename(statementId),
  );
}

export async function saveRentalStatementDocument(statementId: string, file: File) {
  const dir = rentalStatementDir(statementId);
  await fs.mkdir(dir, { recursive: true });

  const storedName = `${randomUUID()}${safeExtension(file.name)}`;
  const fullPath = path.join(dir, storedName);

  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(fullPath, buffer);

  return { storedName, size: buffer.byteLength };
}

export async function readRentalStatementDocument(statementId: string, storedName: string) {
  const fullPath = path.join(rentalStatementDir(statementId), storedName);
  return fs.readFile(fullPath);
}

export async function deleteRentalStatementDocument(statementId: string, storedName: string) {
  const fullPath = path.join(rentalStatementDir(statementId), storedName);
  await fs.rm(fullPath, { force: true });
}

export async function deleteRentalStatementDir(statementId: string) {
  await fs.rm(rentalStatementDir(statementId), { recursive: true, force: true });
}

function inventoryItemDir(inventoryItemId: string) {
  return path.join(
    path.resolve(env.uploadsDir),
    "inventory-items",
    path.basename(inventoryItemId),
  );
}

export async function saveInventoryItemDocument(inventoryItemId: string, file: File) {
  const dir = inventoryItemDir(inventoryItemId);
  await fs.mkdir(dir, { recursive: true });

  const storedName = `${randomUUID()}${safeExtension(file.name)}`;
  const fullPath = path.join(dir, storedName);

  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(fullPath, buffer);

  return { storedName, size: buffer.byteLength };
}

export async function readInventoryItemDocument(inventoryItemId: string, storedName: string) {
  const fullPath = path.join(inventoryItemDir(inventoryItemId), storedName);
  return fs.readFile(fullPath);
}

export async function deleteInventoryItemDocument(inventoryItemId: string, storedName: string) {
  const fullPath = path.join(inventoryItemDir(inventoryItemId), storedName);
  await fs.rm(fullPath, { force: true });
}

export async function deleteInventoryItemDir(inventoryItemId: string) {
  await fs.rm(inventoryItemDir(inventoryItemId), { recursive: true, force: true });
}

function tradeDir(tradeId: string) {
  return path.join(path.resolve(env.uploadsDir), "trades", path.basename(tradeId));
}

export async function saveTradeDocument(tradeId: string, file: File) {
  const dir = tradeDir(tradeId);
  await fs.mkdir(dir, { recursive: true });

  const storedName = `${randomUUID()}${safeExtension(file.name)}`;
  const fullPath = path.join(dir, storedName);

  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(fullPath, buffer);

  return { storedName, size: buffer.byteLength };
}

export async function readTradeDocument(tradeId: string, storedName: string) {
  const fullPath = path.join(tradeDir(tradeId), storedName);
  return fs.readFile(fullPath);
}

export async function deleteTradeDocument(tradeId: string, storedName: string) {
  const fullPath = path.join(tradeDir(tradeId), storedName);
  await fs.rm(fullPath, { force: true });
}

export async function deleteTradeDir(tradeId: string) {
  await fs.rm(tradeDir(tradeId), { recursive: true, force: true });
}
