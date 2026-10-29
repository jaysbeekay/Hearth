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
    rows.inventory[0].warrantyProductId = "product";
    rows.links[0].itemId = "item";
    rows.itemDocuments[1].itemId = "item";
  });

  it("accepts a fully mapped stage", async () => {
    expect(await itemCutoverReadiness()).toMatchObject({ ready: true, problems: [] });
  });

  it("blocks a wrong Inventory link even when every table count matches", async () => {
    rows.inventory[0].warrantyProductId = null;
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
});
