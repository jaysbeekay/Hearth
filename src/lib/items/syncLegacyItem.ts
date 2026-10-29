import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@/generated/prisma/client";
import { mergeItemSources } from "@/lib/items/mergeSources";
import { prisma } from "@/lib/prisma";
import { removeItemDocumentFiles } from "@/lib/storage";
import { removeStagedLegacyDocument } from "@/lib/items/syncLegacyDocument";
import { env } from "@/lib/env";

type Tx = Prisma.TransactionClient;

/** Rehome copied Documents when an InventoryItem is linked or unlinked. */
async function rehomeInventoryDocuments(tx: Tx, sourceId: string, previousItemId: string | undefined, nextItemId: string) {
  if (!previousItemId || previousItemId === nextItemId) return;
  const sourceDocs = await tx.inventoryItemDocument.findMany({ where: { inventoryItemId: sourceId }, select: { id: true } });
  const staged = await tx.itemDocument.findMany({ where: { sourceKind: "INVENTORY_ITEM", sourceDocumentId: { in: sourceDocs.map((doc) => doc.id) }, itemId: previousItemId } });
  const root = path.resolve(env.uploadsDir);
  const destination = path.join(root, "items", path.basename(nextItemId));
  if (staged.length) await mkdir(destination, { recursive: true });
  for (const doc of staged) {
    const from = path.join(root, "items", path.basename(previousItemId), path.basename(doc.storedName));
    const to = path.join(destination, path.basename(doc.storedName));
    try { await copyFile(from, to, constants.COPYFILE_EXCL); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
      if (digest(await readFile(from)) !== digest(await readFile(to))) throw new Error(`Item Document copy differs: ${doc.id}`);
    }
    await tx.itemDocument.update({ where: { id: doc.id }, data: { itemId: nextItemId } });
  }
  const old = await tx.item.findUnique({ where: { id: previousItemId } });
  if (old && !old.legacyProductId && !(await tx.itemLegacyInventory.count({ where: { itemId: old.id } })) && !(await tx.itemDocument.count({ where: { itemId: old.id } }))) {
    await tx.item.delete({ where: { id: old.id } });
  }
}

/** Keep the additive Item stage current while legacy Product writers remain active. */
export async function syncLegacyProduct(tx: Tx, productId: string) {
  const product = await tx.product.findUnique({ where: { id: productId }, include: { warrantyForItems: true } });
  if (!product) return;
  const inventory = product.warrantyForItems;
  const merged = mergeItemSources(product, inventory.map((source) => ({
    id: source.id, createdAt: source.createdAt, deletedAt: source.deletedAt,
    description: source.label, manufacturer: source.brand, model: source.model,
    serialNumber: source.serialNumber, purchaseDate: source.purchaseDate,
    price: source.purchasePrice, currency: source.currency, notes: source.notes,
  })));
  const preferred = [...inventory].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))[0];
  const data = {
    description: merged.fields.description ?? product.description,
    manufacturer: merged.fields.manufacturer, model: merged.fields.model,
    vendor: product.vendor, serialNumber: merged.fields.serialNumber,
    barcode: product.barcode, purchaseDate: merged.fields.purchaseDate,
    price: merged.fields.price, currency: merged.fields.currency ?? product.currency,
    category: preferred?.category, location: preferred?.location,
    propertyId: product.propertyId, notes: merged.fields.notes,
    createdById: product.createdById, deletedAt: merged.deletedAt,
    mergeConflictFields: merged.conflicts.length ? JSON.stringify(merged.conflicts) : null,
  };
  const item = await tx.item.upsert({ where: { legacyProductId: productId }, create: { id: randomUUID(), legacyProductId: productId, ...data }, update: data });
  await tx.warranty.upsert({ where: { itemId: item.id }, create: {
    id: randomUUID(), itemId: item.id, legacyProductId: productId,
    endDate: product.warrantyEndDate, reminderDaysBefore: product.reminderDaysBefore,
    registered: inventory.some((source) => source.warrantyRegistered),
    extended: inventory.some((source) => source.warrantyExtended),
  }, update: {
    endDate: product.warrantyEndDate, reminderDaysBefore: product.reminderDaysBefore,
    registered: inventory.some((source) => source.warrantyRegistered),
    extended: inventory.some((source) => source.warrantyExtended),
  } });
  for (const source of inventory) {
    await tx.itemLegacyInventory.upsert({ where: { inventoryItemId: source.id }, create: { inventoryItemId: source.id, itemId: item.id }, update: { itemId: item.id } });
  }
}

/** Update the Item stage after an InventoryItem changes, including relinking. */
export async function syncLegacyInventory(tx: Tx, inventoryItemId: string, previousProductId?: string | null) {
  const source = await tx.inventoryItem.findUnique({ where: { id: inventoryItemId } });
  const previousMapping = await tx.itemLegacyInventory.findUnique({ where: { inventoryItemId } });
  if (previousProductId && previousProductId !== source?.warrantyProductId) await syncLegacyProduct(tx, previousProductId);
  if (!source) return;
  if (source.warrantyProductId) {
    await syncLegacyProduct(tx, source.warrantyProductId);
    const nextMapping = await tx.itemLegacyInventory.findUnique({ where: { inventoryItemId } });
    if (nextMapping) await rehomeInventoryDocuments(tx, inventoryItemId, previousMapping?.itemId, nextMapping.itemId);
    return;
  }
  const data = {
    description: source.label, manufacturer: source.brand, model: source.model,
    serialNumber: source.serialNumber, purchaseDate: source.purchaseDate,
    price: source.purchasePrice, currency: source.currency,
    category: source.category, location: source.location, notes: source.notes,
    createdById: source.createdById, deletedAt: source.deletedAt,
  };
  const mapping = await tx.itemLegacyInventory.findUnique({ where: { inventoryItemId } });
  const mappedItem = mapping ? await tx.item.findUnique({ where: { id: mapping.itemId } }) : null;
  const item = mappedItem && !mappedItem.legacyProductId
    ? await tx.item.update({ where: { id: mappedItem.id }, data })
    : await tx.item.create({ data: { id: randomUUID(), ...data } });
  await tx.itemLegacyInventory.upsert({ where: { inventoryItemId }, create: { inventoryItemId, itemId: item.id }, update: { itemId: item.id } });
  await rehomeInventoryDocuments(tx, inventoryItemId, previousMapping?.itemId, item.id);
}

/** Retire the staged source after an InventoryItem has been hard-deleted. */
export async function purgeLegacyInventoryStage(inventoryItemId: string, documentIds: string[]) {
  const mapping = await prisma.itemLegacyInventory.findUnique({ where: { inventoryItemId }, include: { item: true } });
  if (!mapping) return;
  for (const id of documentIds) await removeStagedLegacyDocument("INVENTORY_ITEM", id);
  await prisma.itemLegacyInventory.delete({ where: { inventoryItemId } });
  if (mapping.item.legacyProductId) {
    await prisma.$transaction((tx) => syncLegacyProduct(tx, mapping.item.legacyProductId!));
  } else {
    await prisma.item.delete({ where: { id: mapping.itemId } });
    await removeItemDocumentFiles(mapping.itemId);
  }
}
