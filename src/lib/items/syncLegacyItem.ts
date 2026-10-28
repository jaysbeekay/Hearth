import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { mergeItemSources } from "@/lib/items/mergeSources";

type Tx = Prisma.TransactionClient;

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
  if (previousProductId && previousProductId !== source?.warrantyProductId) await syncLegacyProduct(tx, previousProductId);
  if (!source) return;
  if (source.warrantyProductId) {
    await syncLegacyProduct(tx, source.warrantyProductId);
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
}
