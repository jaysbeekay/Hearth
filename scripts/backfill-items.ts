/** #380 staging backfill. Run only against an explicit SQLite copy. */
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { mergeItemSources } from "../src/lib/items/mergeSources";
import { assertDisposableTargets } from "./itemStageGuard";

async function main() {
const argument = process.argv[2];
if (!argument || process.argv.length !== 3 || !argument.startsWith("/")) {
  throw new Error("Usage: node --import tsx scripts/backfill-items.ts /absolute/path/to/copy.db");
}
const file = await stat(argument).catch(() => null);
if (!file?.isFile()) throw new Error("Pass an existing local database copy");
assertDisposableTargets([argument]);

const prisma = new PrismaClient({ adapter: new PrismaLibSql({ url: `file:${resolve(argument)}` }) });
let merged = 0;
let standalone = 0;
let conflicts = 0;

try {
  const products = await prisma.product.findMany({ include: { warrantyForItems: true } });
  for (const product of products) {
    const inventory = product.warrantyForItems;
    const result = mergeItemSources(
      product,
      inventory.map((source) => ({
        id: source.id,
        createdAt: source.createdAt,
        deletedAt: source.deletedAt,
        description: source.label,
        manufacturer: source.brand,
        model: source.model,
        serialNumber: source.serialNumber,
        purchaseDate: source.purchaseDate,
        price: source.purchasePrice,
        currency: source.currency,
        notes: source.notes,
      })),
    );
    conflicts += result.conflicts.length;
    const preferred = [...inventory].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))[0];
    await prisma.$transaction(async (tx) => {
      const data = {
        description: result.fields.description ?? product.description,
        manufacturer: result.fields.manufacturer,
        model: result.fields.model,
        vendor: product.vendor,
        serialNumber: result.fields.serialNumber,
        barcode: product.barcode,
        purchaseDate: result.fields.purchaseDate,
        price: result.fields.price,
        currency: result.fields.currency ?? product.currency,
        category: preferred?.category,
        location: preferred?.location,
        propertyId: product.propertyId,
        notes: result.fields.notes,
        createdById: product.createdById,
        deletedAt: result.deletedAt,
        mergeConflictFields: result.conflicts.length ? JSON.stringify(result.conflicts) : null,
      };
      const item = await tx.item.upsert({ where: { legacyProductId: product.id }, create: { id: randomUUID(), legacyProductId: product.id, ...data }, update: data });
      await tx.warranty.upsert({
        where: { itemId: item.id },
        create: { id: randomUUID(), itemId: item.id, legacyProductId: product.id, endDate: product.warrantyEndDate, reminderDaysBefore: product.reminderDaysBefore, registered: inventory.some((source) => source.warrantyRegistered), extended: inventory.some((source) => source.warrantyExtended) },
        update: { endDate: product.warrantyEndDate, reminderDaysBefore: product.reminderDaysBefore, registered: inventory.some((source) => source.warrantyRegistered), extended: inventory.some((source) => source.warrantyExtended) },
      });
      for (const source of inventory) {
        await tx.itemLegacyInventory.upsert({ where: { inventoryItemId: source.id }, create: { inventoryItemId: source.id, itemId: item.id }, update: { itemId: item.id } });
      }
    });
    merged++;
  }

  const unlinked = await prisma.inventoryItem.findMany({ where: { warrantyProductId: null } });
  for (const source of unlinked) {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.itemLegacyInventory.findUnique({ where: { inventoryItemId: source.id } });
      const data = { description: source.label, manufacturer: source.brand, model: source.model, serialNumber: source.serialNumber, purchaseDate: source.purchaseDate, price: source.purchasePrice, currency: source.currency, category: source.category, location: source.location, notes: source.notes, createdById: source.createdById, deletedAt: source.deletedAt };
      const item = existing
        ? await tx.item.update({ where: { id: existing.itemId }, data })
        : await tx.item.create({ data: { id: randomUUID(), ...data } });
      await tx.itemLegacyInventory.upsert({ where: { inventoryItemId: source.id }, create: { inventoryItemId: source.id, itemId: item.id }, update: { itemId: item.id } });
    });
    standalone++;
  }
  console.log(JSON.stringify({ mergedProducts: merged, unlinkedInventoryItems: standalone, conflictingFields: conflicts, note: "Legacy Documents remain on their source records until the Document cutover." }, null, 2));
} finally {
  await prisma.$disconnect();
}
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
