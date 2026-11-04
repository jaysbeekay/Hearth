import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Prisma } from "@/generated/prisma/client";
import { mergeItemSources } from "@/lib/items/mergeSources";
import { prisma } from "@/lib/prisma";
import { removeItemDocumentFiles } from "@/lib/storage";
import { removeStagedLegacyDocument, syncLegacyDocument } from "@/lib/items/syncLegacyDocument";
import { env } from "@/lib/env";
import { queueStagedFileMove, withStagedFileMoves } from "@/lib/items/stagedFileMoves";

type Tx = Prisma.TransactionClient;

/**
 * Rehome copied Documents when an InventoryItem is linked or unlinked. Only
 * database work happens here; the file copies are queued for after the legacy
 * write commits (see stagedFileMoves.ts), so a missing staged copy can't roll
 * the legacy write back.
 */
async function rehomeInventoryDocuments(tx: Tx, sourceId: string, previousItemId: string | undefined, nextItemId: string) {
  if (!previousItemId || previousItemId === nextItemId) return;
  const sourceDocs = await tx.inventoryItemDocument.findMany({ where: { inventoryItemId: sourceId }, select: { id: true } });
  const staged = await tx.itemDocument.findMany({ where: { sourceKind: "INVENTORY_ITEM", sourceDocumentId: { in: sourceDocs.map((doc) => doc.id) }, itemId: previousItemId } });
  const root = path.resolve(env.uploadsDir);
  for (const doc of staged) {
    const name = path.basename(doc.storedName);
    queueStagedFileMove({
      documentId: doc.id,
      from: path.join(root, "items", path.basename(previousItemId), name),
      to: path.join(root, "items", path.basename(nextItemId), name),
    });
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
  // Every nullable field is coalesced to null: Prisma skips an undefined
  // field on update, so clearing the last legacy value would otherwise leave
  // the staged Item stale (#445 review).
  const data = {
    description: merged.fields.description ?? product.description,
    manufacturer: merged.fields.manufacturer ?? null, model: merged.fields.model ?? null,
    vendor: product.vendor, serialNumber: merged.fields.serialNumber ?? null,
    barcode: product.barcode, purchaseDate: merged.fields.purchaseDate ?? null,
    price: merged.fields.price ?? null, currency: merged.fields.currency ?? product.currency,
    category: preferred?.category ?? null, location: preferred?.location ?? null,
    propertyId: product.propertyId, notes: merged.fields.notes ?? null,
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

/**
 * Retire the stage of a hard-deleted Product: drop its staged Item and rehome
 * the InventoryItems that pointed at it as standalone Items. Best-effort and
 * never throws; the legacy delete has already happened.
 */
export async function retireStagedProduct(productId: string, stagedItemId: string | null, linkedInventoryIds: string[]) {
  try {
    if (stagedItemId) {
      await prisma.item.delete({ where: { id: stagedItemId } });
      await removeItemDocumentFiles(stagedItemId);
    }
    for (const sourceId of linkedInventoryIds) {
      await withStagedFileMoves(() => prisma.$transaction((tx) => syncLegacyInventory(tx, sourceId)));
      const docs = await prisma.inventoryItemDocument.findMany({ where: { inventoryItemId: sourceId }, select: { id: true } });
      for (const doc of docs) await syncLegacyDocument("INVENTORY_ITEM", doc.id);
    }
  } catch (error) {
    console.error("[items] couldn't finish staged Product purge %s", productId, error);
  }
}

/**
 * #445 review: a purge whose stage cleanup failed used to leave staged rows
 * behind for good, since the legacy source was gone. Trash retention calls
 * this on every run, so a failed retirement is retried: any staged Item whose
 * Product is gone, and any Inventory link whose InventoryItem is gone, is
 * retired the same way the purge would have.
 */
export async function retireOrphanedStages() {
  const productItems = await prisma.item.findMany({ where: { legacyProductId: { not: null } }, select: { id: true, legacyProductId: true } });
  const liveProducts = new Set((await prisma.product.findMany({
    where: { id: { in: productItems.map((item) => item.legacyProductId!) } }, select: { id: true },
  })).map((product) => product.id));
  for (const item of productItems) {
    if (liveProducts.has(item.legacyProductId!)) continue;
    const links = await prisma.itemLegacyInventory.findMany({ where: { itemId: item.id }, select: { inventoryItemId: true } });
    const surviving = await prisma.inventoryItem.findMany({ where: { id: { in: links.map((link) => link.inventoryItemId) } }, select: { id: true } });
    await retireStagedProduct(item.legacyProductId!, item.id, surviving.map((source) => source.id));
  }

  const links = await prisma.itemLegacyInventory.findMany({ select: { inventoryItemId: true, itemId: true } });
  const liveInventory = new Set((await prisma.inventoryItem.findMany({
    where: { id: { in: links.map((link) => link.inventoryItemId) } }, select: { id: true },
  })).map((source) => source.id));
  for (const link of links) {
    if (liveInventory.has(link.inventoryItemId)) continue;
    const staged = await prisma.itemDocument.findMany({ where: { itemId: link.itemId, sourceKind: "INVENTORY_ITEM" }, select: { sourceDocumentId: true } });
    const liveDocs = new Set((await prisma.inventoryItemDocument.findMany({
      where: { id: { in: staged.map((doc) => doc.sourceDocumentId) } }, select: { id: true },
    })).map((doc) => doc.id));
    const goneDocs = staged.map((doc) => doc.sourceDocumentId).filter((id) => !liveDocs.has(id));
    try { await purgeLegacyInventoryStage(link.inventoryItemId, goneDocs); }
    catch (error) { console.error("[items] couldn't retire staged Inventory item %s", link.inventoryItemId, error); }
  }
}
