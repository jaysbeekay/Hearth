/** #380 copy-only Document backfill; run after backfill-items.ts on a DB copy. */
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

async function main() {
  const [databasePath, uploadsPath] = process.argv.slice(2);
  if (process.argv.length !== 4 || !databasePath?.startsWith("/") || !uploadsPath?.startsWith("/")) {
    throw new Error("Usage: node --import tsx scripts/backfill-item-documents.ts /absolute/copy.db /absolute/uploads-copy");
  }
  if (!(await stat(databasePath).catch(() => null))?.isFile() || !(await stat(uploadsPath).catch(() => null))?.isDirectory()) {
    throw new Error("Pass an existing database file and uploads directory copy");
  }
  const prisma = new PrismaClient({ adapter: new PrismaLibSql({ url: `file:${databasePath}` }) });
  let copied = 0;
  let versionLinks = 0;

  async function copyDocument(sourceKind: "PRODUCT" | "INVENTORY_ITEM", ownerId: string, itemId: string, doc: {
    id: string; filename: string; storedName: string; mimeType: string; size: number;
    category: string | null; isImportant: boolean; deletedAt: Date | null;
    supersedesId: string | null; uploadedAt: Date; sha256: string | null;
    kind?: "INVOICE" | "PHOTO" | "MANUAL" | "OTHER"; extractedText?: string | null;
    extractionStatus?: string;
  }) {
    const sourceDir = sourceKind === "PRODUCT" ? "products" : "inventory-items";
    const source = path.join(uploadsPath, sourceDir, path.basename(ownerId), path.basename(doc.storedName));
    const targetDir = path.join(uploadsPath, "items", path.basename(itemId));
    const storedName = `${sourceKind.toLowerCase()}-${doc.id}-${path.basename(doc.storedName)}`;
    const target = path.join(targetDir, storedName);
    await mkdir(targetDir, { recursive: true });
    try {
      await copyFile(source, target, constants.COPYFILE_EXCL);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const digest = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
      if (digest(await readFile(source)) !== digest(await readFile(target))) {
        throw new Error(`Existing Item Document copy differs: ${sourceKind}/${doc.id}`);
      }
    }
    const key = { sourceKind_sourceDocumentId: { sourceKind, sourceDocumentId: doc.id } };
    const data = {
      itemId, filename: doc.filename, storedName, mimeType: doc.mimeType, size: doc.size,
      kind: doc.kind ?? "OTHER" as const, extractedText: doc.extractedText ?? null,
      extractionStatus: doc.extractionStatus ?? "PENDING", sha256: doc.sha256,
      category: doc.category, isImportant: doc.isImportant, deletedAt: doc.deletedAt,
      uploadedAt: doc.uploadedAt,
    };
    await prisma.itemDocument.upsert({ where: key, create: { id: randomUUID(), sourceKind, sourceDocumentId: doc.id, ...data }, update: data });
    copied++;
  }

  try {
    const items = await prisma.item.findMany({ include: { legacyInventories: true } });
    for (const item of items) {
      if (item.legacyProductId) {
        const docs = await prisma.productDocument.findMany({ where: { productId: item.legacyProductId } });
        for (const doc of docs) await copyDocument("PRODUCT", item.legacyProductId, item.id, doc);
      }
      for (const source of item.legacyInventories) {
        const docs = await prisma.inventoryItemDocument.findMany({ where: { inventoryItemId: source.inventoryItemId } });
        for (const doc of docs) await copyDocument("INVENTORY_ITEM", source.inventoryItemId, item.id, doc);
      }
    }
    // Version links are set after all rows exist, including those whose
    // predecessor appeared later in iteration order.
    const staged = await prisma.itemDocument.findMany({ select: { id: true, sourceKind: true, sourceDocumentId: true } });
    const bySource = new Map(staged.map((doc) => [`${doc.sourceKind}:${doc.sourceDocumentId}`, doc.id]));
    for (const doc of await prisma.productDocument.findMany({ where: { supersedesId: { not: null } }, select: { id: true, supersedesId: true } })) {
      const id = bySource.get(`PRODUCT:${doc.id}`);
      const predecessor = bySource.get(`PRODUCT:${doc.supersedesId}`);
      if (id && predecessor) { await prisma.itemDocument.update({ where: { id }, data: { supersedesId: predecessor } }); versionLinks++; }
    }
    for (const doc of await prisma.inventoryItemDocument.findMany({ where: { supersedesId: { not: null } }, select: { id: true, supersedesId: true } })) {
      const id = bySource.get(`INVENTORY_ITEM:${doc.id}`);
      const predecessor = bySource.get(`INVENTORY_ITEM:${doc.supersedesId}`);
      if (id && predecessor) { await prisma.itemDocument.update({ where: { id }, data: { supersedesId: predecessor } }); versionLinks++; }
    }
    console.log(JSON.stringify({ copiedDocuments: copied, restoredVersionLinks: versionLinks, note: "Legacy rows and files remain until the Item cutover." }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
