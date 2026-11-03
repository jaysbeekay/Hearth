import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => ({
  products: [{ id: "product" }],
  inventory: [{ id: "inventory", warrantyProductId: "product" as string | null }],
  productDocuments: [{ id: "product-doc", productId: "product" }],
  inventoryDocuments: [{ id: "inventory-doc", inventoryItemId: "inventory" }],
  items: [{ id: "item", legacyProductId: "product" as string | null }],
  warranties: [{ itemId: "item", legacyProductId: "product" }],
  links: [{ inventoryItemId: "inventory", itemId: "item" }],
  itemDocuments: [
    { sourceKind: "PRODUCT", sourceDocumentId: "product-doc", itemId: "item" },
    { sourceKind: "INVENTORY_ITEM", sourceDocumentId: "inventory-doc", itemId: "item" },
  ],
}));

vi.mock("@/lib/prisma", () => ({ prisma: {
  product: { findMany: async () => rows.products },
  inventoryItem: { findMany: async () => rows.inventory },
  productDocument: { findMany: async () => rows.productDocuments },
  inventoryItemDocument: { findMany: async () => rows.inventoryDocuments },
  item: { findMany: async () => rows.items },
  warranty: { findMany: async () => rows.warranties },
  itemLegacyInventory: { findMany: async () => rows.links },
  itemDocument: { findMany: async () => rows.itemDocuments },
} }));

import { itemCutoverReadiness } from "@/lib/items/cutoverReadiness";

describe("Item cutover readiness", () => {
  beforeEach(() => {
    rows.inventory.splice(0, rows.inventory.length, { id: "inventory", warrantyProductId: "product" });
    rows.items.splice(0, rows.items.length, { id: "item", legacyProductId: "product" });
    rows.links.splice(0, rows.links.length, { inventoryItemId: "inventory", itemId: "item" });
    rows.inventoryDocuments.splice(0, rows.inventoryDocuments.length, { id: "inventory-doc", inventoryItemId: "inventory" });
    rows.itemDocuments[1].itemId = "item";
  });

  it("accepts a fully mapped stage", async () => {
    expect(await itemCutoverReadiness()).toMatchObject({ ready: true, problems: [] });
  });

  it("blocks a wrong Inventory link even when every table count matches", async () => {
    // Only the link changes, so every expected/actual count still matches.
    rows.links[0].itemId = "different-item";
    const result = await itemCutoverReadiness();
    expect(result.ready).toBe(false);
    expect(result.problems).toContain("InventoryItem inventory points to the wrong Item");
  });

  it("blocks a wrongly owned Document even when Document counts match", async () => {
    rows.itemDocuments[1].itemId = "different-item";
    const result = await itemCutoverReadiness();
    expect(result.ready).toBe(false);
    expect(result.problems).toContain("InventoryItemDocument inventory-doc has no correctly owned Item copy");
  });

  // #445 review: two unlinked InventoryItems sharing one standalone Item, with
  // an orphan standalone Item making up the count, must not pass.
  it("blocks two InventoryItems sharing one standalone Item", async () => {
    rows.inventory.push({ id: "loose-a", warrantyProductId: null }, { id: "loose-b", warrantyProductId: null });
    rows.items.push({ id: "standalone", legacyProductId: null }, { id: "orphan", legacyProductId: null });
    rows.links.push({ inventoryItemId: "loose-a", itemId: "standalone" }, { inventoryItemId: "loose-b", itemId: "standalone" });
    const result = await itemCutoverReadiness();
    expect(result.actual).toMatchObject({ items: result.expected.items, links: result.expected.links });
    expect(result.ready).toBe(false);
    expect(result.problems).toContain("Standalone Item standalone has 2 InventoryItem links");
    expect(result.problems).toContain("Standalone Item orphan has 0 InventoryItem links");
  });
});
