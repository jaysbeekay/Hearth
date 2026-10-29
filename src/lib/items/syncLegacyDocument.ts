import { randomUUID, createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";

type LegacyKind = "PRODUCT" | "INVENTORY_ITEM";

// Every staged path is assembled from basename'd segments and then proved to
// stay inside its root before it reaches the filesystem: the segments come
// from database rows and the root from the environment, and neither should
// ever steer a write outside the uploads directory (#445, CodeQL
// path-injection).
function stagedPath(root: string, ...segments: string[]): string {
  const target = path.join(root, ...segments.map((segment) => path.basename(segment)));
  if (!target.startsWith(root + path.sep)) {
    throw new Error("Staged Item path escapes the uploads root");
  }
  return target;
}

function stagedName(kind: LegacyKind, id: string, storedName: string) {
  return `${kind.toLowerCase()}-${path.basename(id)}-${path.basename(storedName)}`;
}

/** Mirror one legacy Document without changing its live row or file. */
export async function syncLegacyDocument(kind: LegacyKind, id: string) {
  const source = kind === "PRODUCT"
    ? await prisma.productDocument.findUnique({ where: { id } })
    : await prisma.inventoryItemDocument.findUnique({ where: { id } });
  if (!source) return;
  const ownerId = kind === "PRODUCT" ? (source as { productId: string }).productId : (source as { inventoryItemId: string }).inventoryItemId;
  const item = kind === "PRODUCT"
    ? await prisma.item.findUnique({ where: { legacyProductId: ownerId } })
    : (await prisma.itemLegacyInventory.findUnique({ where: { inventoryItemId: ownerId }, include: { item: true } }))?.item;
  if (!item) return;

  const root = path.resolve(env.uploadsDir);
  const from = stagedPath(root, kind === "PRODUCT" ? "products" : "inventory-items", ownerId, source.storedName);
  const toDir = stagedPath(root, "items", item.id);
  const storedName = stagedName(kind, id, source.storedName);
  const to = stagedPath(toDir, storedName);
  await mkdir(toDir, { recursive: true });
  try {
    await copyFile(from, to, constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const digest = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
    if (digest(await readFile(from)) !== digest(await readFile(to))) throw new Error(`Item Document copy differs: ${kind}/${id}`);
  }
  const previous = source.supersedesId
    ? await prisma.itemDocument.findUnique({ where: { sourceKind_sourceDocumentId: { sourceKind: kind, sourceDocumentId: source.supersedesId } } })
    : null;
  const productFields = kind === "PRODUCT" ? source as { kind: "INVOICE" | "PHOTO" | "MANUAL" | "OTHER"; extractedText: string | null; extractionStatus: string } : null;
  const data = {
    itemId: item.id, filename: source.filename, storedName, mimeType: source.mimeType,
    size: source.size, kind: productFields?.kind ?? "OTHER" as const,
    extractedText: productFields?.extractedText ?? null,
    extractionStatus: productFields?.extractionStatus ?? "PENDING", sha256: source.sha256,
    category: source.category, isImportant: source.isImportant,
    deletedAt: source.deletedAt, uploadedAt: source.uploadedAt,
    supersedesId: previous?.id ?? null,
  };
  await prisma.itemDocument.upsert({
    where: { sourceKind_sourceDocumentId: { sourceKind: kind, sourceDocumentId: id } },
    create: { id: randomUUID(), sourceKind: kind, sourceDocumentId: id, ...data }, update: data,
  });
}

export async function removeStagedLegacyDocument(kind: LegacyKind, id: string) {
  const row = await prisma.itemDocument.findUnique({ where: { sourceKind_sourceDocumentId: { sourceKind: kind, sourceDocumentId: id } } });
  if (!row) return;
  await prisma.itemDocument.delete({ where: { id: row.id } });
  await rm(stagedPath(path.resolve(env.uploadsDir), "items", row.itemId, row.storedName), { force: true });
}
