import { prisma } from "@/lib/prisma";

/** Verify the relational stage before exposing any Item read route. */
export async function itemCutoverReadiness() {
  const [products, inventory, productDocuments, inventoryDocuments, items, warranties, links, itemDocuments] = await Promise.all([
    prisma.product.findMany({ select: { id: true } }),
    prisma.inventoryItem.findMany({ select: { id: true, warrantyProductId: true } }),
    prisma.productDocument.findMany({ select: { id: true, productId: true } }),
    prisma.inventoryItemDocument.findMany({ select: { id: true, inventoryItemId: true } }),
    prisma.item.findMany({ select: { id: true, legacyProductId: true } }),
    prisma.warranty.findMany({ select: { itemId: true, legacyProductId: true } }),
    prisma.itemLegacyInventory.findMany({ select: { inventoryItemId: true, itemId: true } }),
    prisma.itemDocument.findMany({ select: { sourceKind: true, sourceDocumentId: true, itemId: true } }),
  ]);

  const expected = {
    items: products.length + inventory.filter((source) => !source.warrantyProductId).length,
    warranties: products.length,
    links: inventory.length,
    documents: productDocuments.length + inventoryDocuments.length,
  };
  const actual = { items: items.length, warranties: warranties.length, links: links.length, documents: itemDocuments.length };
  const problems: string[] = [];
  for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
    if (expected[key] !== actual[key]) problems.push(`${key}: expected ${expected[key]}, found ${actual[key]}`);
  }

  const itemById = new Map(items.map((item) => [item.id, item]));
  const productItem = new Map(items.filter((item) => item.legacyProductId).map((item) => [item.legacyProductId, item.id]));
  const linkByInventory = new Map(links.map((link) => [link.inventoryItemId, link.itemId]));
  const warrantyByItem = new Map(warranties.map((warranty) => [warranty.itemId, warranty]));
  const productIds = new Set(products.map((product) => product.id));
  const inventoryIds = new Set(inventory.map((source) => source.id));

  for (const product of products) {
    const itemId = productItem.get(product.id);
    if (!itemId) { problems.push(`Product ${product.id} has no Item`); continue; }
    if (warrantyByItem.get(itemId)?.legacyProductId !== product.id) problems.push(`Product ${product.id} has no matching Warranty`);
  }
  for (const item of items) {
    if (item.legacyProductId && !productIds.has(item.legacyProductId)) problems.push(`Item ${item.id} has an absent Product`);
  }
  for (const source of inventory) {
    const itemId = linkByInventory.get(source.id);
    if (!itemId) { problems.push(`InventoryItem ${source.id} has no Item link`); continue; }
    const item = itemById.get(itemId);
    if (!item || item.legacyProductId !== source.warrantyProductId) problems.push(`InventoryItem ${source.id} points to the wrong Item`);
  }
  for (const link of links) {
    if (!inventoryIds.has(link.inventoryItemId)) problems.push(`Item link ${link.inventoryItemId} has an absent InventoryItem`);
  }
  const stagedDocument = new Map(itemDocuments.map((doc) => [`${doc.sourceKind}:${doc.sourceDocumentId}`, doc]));
  for (const doc of productDocuments) {
    if (stagedDocument.get(`PRODUCT:${doc.id}`)?.itemId !== productItem.get(doc.productId)) problems.push(`ProductDocument ${doc.id} has no correctly owned Item copy`);
  }
  for (const doc of inventoryDocuments) {
    if (stagedDocument.get(`INVENTORY_ITEM:${doc.id}`)?.itemId !== linkByInventory.get(doc.inventoryItemId)) problems.push(`InventoryItemDocument ${doc.id} has no correctly owned Item copy`);
  }
  return { ready: problems.length === 0, expected, actual, problems };
}
