import { prisma } from "@/lib/prisma";

/** Blocks preview reads until the one-time row and Document backfills ran. */
export async function itemCutoverReadiness() {
  const [products, unlinkedInventory, inventory, productDocuments, inventoryDocuments, items, warranties, links, itemDocuments] = await Promise.all([
    prisma.product.count(), prisma.inventoryItem.count({ where: { warrantyProductId: null } }),
    prisma.inventoryItem.count(), prisma.productDocument.count(), prisma.inventoryItemDocument.count(),
    prisma.item.count(), prisma.warranty.count(), prisma.itemLegacyInventory.count(), prisma.itemDocument.count(),
  ]);
  const expected = { items: products + unlinkedInventory, warranties: products, links: inventory, documents: productDocuments + inventoryDocuments };
  const actual = { items, warranties, links, documents: itemDocuments };
  return { ready: Object.keys(expected).every((key) => expected[key as keyof typeof expected] === actual[key as keyof typeof actual]), expected, actual };
}
