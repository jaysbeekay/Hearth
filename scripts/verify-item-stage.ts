/** Read-only deployment gate for an explicitly supplied database/uploads copy. */
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { mergeItemSources } from "../src/lib/items/mergeSources";

async function digest(file: string) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

function same(left: unknown, right: unknown) {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  return (left ?? null) === (right ?? null);
}

async function main() {
  const [databasePath, uploadsPath] = process.argv.slice(2);
  if (process.argv.length !== 4 || !databasePath?.startsWith("/") || !uploadsPath?.startsWith("/")) {
    throw new Error("Usage: node --import tsx scripts/verify-item-stage.ts /absolute/copy.db /absolute/uploads-copy");
  }
  if (!(await stat(databasePath).catch(() => null))?.isFile() || !(await stat(uploadsPath).catch(() => null))?.isDirectory()) {
    throw new Error("Pass an existing database file and uploads directory copy");
  }
  const prisma = new PrismaClient({ adapter: new PrismaLibSql({ url: `file:${databasePath}` }) });
  const problems: string[] = [];
  try {
    const [products, inventory, items, warranties, links, stagedDocs, productDocs, inventoryDocs] = await Promise.all([
      prisma.product.findMany({ include: { warrantyForItems: true } }), prisma.inventoryItem.findMany(),
      prisma.item.findMany(), prisma.warranty.findMany(), prisma.itemLegacyInventory.findMany(),
      prisma.itemDocument.findMany(), prisma.productDocument.findMany(), prisma.inventoryItemDocument.findMany(),
    ]);
    const productItems = new Map(items.filter((item) => item.legacyProductId).map((item) => [item.legacyProductId, item]));
    const itemsById = new Map(items.map((item) => [item.id, item]));
    const linksByInventory = new Map(links.map((link) => [link.inventoryItemId, link.itemId]));
    const warrantiesByItem = new Map(warranties.map((warranty) => [warranty.itemId, warranty]));
    const docsBySource = new Map(stagedDocs.map((doc) => [`${doc.sourceKind}:${doc.sourceDocumentId}`, doc]));
    const expectedItemCount = products.length + inventory.filter((source) => !source.warrantyProductId).length;
    if (items.length !== expectedItemCount) problems.push(`Item count ${items.length} differs from expected ${expectedItemCount}`);
    if (warranties.length !== products.length) problems.push(`Warranty count ${warranties.length} differs from Product count ${products.length}`);
    if (links.length !== inventory.length) problems.push(`Inventory link count ${links.length} differs from InventoryItem count ${inventory.length}`);
    if (stagedDocs.length !== productDocs.length + inventoryDocs.length) problems.push("Item Document count differs from legacy Document count");
    const ftsRows = await prisma.$queryRaw<Array<{ itemId: string; docId: string; filename: string; extractedText: string | null }>>`
      SELECT itemId, docId, filename, extractedText FROM item_document_search_fts
    `;
    const ftsById = new Map(ftsRows.map((row) => [row.docId, row]));
    if (ftsRows.length !== stagedDocs.length) problems.push("Item Document search index count differs from staged Documents");
    for (const doc of stagedDocs) {
      const row = ftsById.get(doc.id);
      if (!row || row.itemId !== doc.itemId || row.filename !== doc.filename || !same(row.extractedText, doc.extractedText)) {
        problems.push(`Item Document ${doc.id} search index differs`);
      }
    }

    for (const product of products) {
      const item = productItems.get(product.id);
      if (!item) { problems.push(`Product ${product.id} has no Item`); continue; }
      const linked = product.warrantyForItems;
      const merged = mergeItemSources(product, linked.map((source) => ({
        id: source.id, createdAt: source.createdAt, deletedAt: source.deletedAt,
        description: source.label, manufacturer: source.brand, model: source.model,
        serialNumber: source.serialNumber, purchaseDate: source.purchaseDate,
        price: source.purchasePrice, currency: source.currency, notes: source.notes,
      })));
      const preferred = [...linked].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))[0];
      const fields = {
        description: merged.fields.description ?? product.description,
        manufacturer: merged.fields.manufacturer, model: merged.fields.model,
        serialNumber: merged.fields.serialNumber, purchaseDate: merged.fields.purchaseDate,
        price: merged.fields.price, currency: merged.fields.currency ?? product.currency,
        notes: merged.fields.notes, vendor: product.vendor, barcode: product.barcode,
        category: preferred?.category, location: preferred?.location,
        propertyId: product.propertyId, createdById: product.createdById,
        deletedAt: merged.deletedAt,
      };
      for (const [name, expected] of Object.entries(fields)) {
        if (!same(item[name as keyof typeof item], expected)) problems.push(`Product ${product.id} Item field ${name} differs`);
      }
      if (!same(item.mergeConflictFields, merged.conflicts.length ? JSON.stringify(merged.conflicts) : null)) {
        problems.push(`Product ${product.id} merge conflict markers differ`);
      }
      const warranty = warrantiesByItem.get(item.id);
      if (!warranty || warranty.legacyProductId !== product.id || !same(warranty.endDate, product.warrantyEndDate) ||
          !same(warranty.reminderDaysBefore, product.reminderDaysBefore) ||
          warranty.registered !== linked.some((source) => source.warrantyRegistered) ||
          warranty.extended !== linked.some((source) => source.warrantyExtended)) {
        problems.push(`Product ${product.id} has a missing or stale Warranty`);
      }
    }
    for (const source of inventory) {
      const item = itemsById.get(linksByInventory.get(source.id) ?? "");
      if (!item || item.legacyProductId !== source.warrantyProductId) problems.push(`InventoryItem ${source.id} has an incorrect Item link`);
      if (item && !source.warrantyProductId) {
        const fields = {
          description: source.label, manufacturer: source.brand, model: source.model,
          serialNumber: source.serialNumber, purchaseDate: source.purchaseDate,
          price: source.purchasePrice, currency: source.currency, category: source.category,
          location: source.location, notes: source.notes, createdById: source.createdById,
          deletedAt: source.deletedAt,
        };
        for (const [name, expected] of Object.entries(fields)) {
          if (!same(item[name as keyof typeof item], expected)) problems.push(`InventoryItem ${source.id} Item field ${name} differs`);
        }
      }
    }

    async function verifyDocument(kind: "PRODUCT" | "INVENTORY_ITEM", doc: {
      id: string; storedName: string; filename: string; size: number; deletedAt: Date | null;
      isImportant: boolean; supersedesId: string | null; productId?: string; inventoryItemId?: string;
    }) {
      const stage = docsBySource.get(`${kind}:${doc.id}`);
      const ownerId = kind === "PRODUCT" ? doc.productId! : doc.inventoryItemId!;
      const expectedItem = kind === "PRODUCT" ? productItems.get(ownerId)?.id : linksByInventory.get(ownerId);
      if (!stage || stage.itemId !== expectedItem) { problems.push(`${kind} Document ${doc.id} is missing or incorrectly owned`); return; }
      if (stage.filename !== doc.filename || stage.size !== doc.size || stage.isImportant !== doc.isImportant ||
          stage.deletedAt?.getTime() !== doc.deletedAt?.getTime()) problems.push(`${kind} Document ${doc.id} metadata differs`);
      const predecessor = doc.supersedesId ? docsBySource.get(`${kind}:${doc.supersedesId}`) : null;
      if (stage.supersedesId !== (predecessor?.id ?? null)) problems.push(`${kind} Document ${doc.id} version link differs`);
      const source = path.join(uploadsPath, kind === "PRODUCT" ? "products" : "inventory-items", path.basename(ownerId), path.basename(doc.storedName));
      const target = path.join(uploadsPath, "items", path.basename(stage.itemId), path.basename(stage.storedName));
      try {
        if ((await digest(source)) !== (await digest(target))) problems.push(`${kind} Document ${doc.id} file bytes differ`);
      } catch (error) { problems.push(`${kind} Document ${doc.id} file cannot be read: ${(error as Error).message}`); }
    }
    for (const doc of productDocs) await verifyDocument("PRODUCT", doc);
    for (const doc of inventoryDocs) await verifyDocument("INVENTORY_ITEM", doc);
    console.log(JSON.stringify({ ready: problems.length === 0, expected: { items: expectedItemCount, warranties: products.length, links: inventory.length, documents: productDocs.length + inventoryDocs.length }, actual: { items: items.length, warranties: warranties.length, links: links.length, documents: stagedDocs.length }, problems }, null, 2));
    if (problems.length) process.exitCode = 1;
  } finally { await prisma.$disconnect(); }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
