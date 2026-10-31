import { describe, expect, it } from "vitest";
import { mergeItemSources } from "@/lib/items/mergeSources";

describe("legacy Item source merge", () => {
  it("takes present Inventory values, retains Product gaps, and flags conflicts", () => {
    const result = mergeItemSources(
      { id: "product", description: "Fridge", manufacturer: "Old brand", serialNumber: "P1", price: 800 },
      [{ id: "inventory", createdAt: new Date("2025-01-01"), description: "Kitchen fridge", manufacturer: "New brand", model: "X", price: 900 }],
    );

    expect(result.fields).toMatchObject({ description: "Kitchen fridge", manufacturer: "New brand", model: "X", serialNumber: "P1", price: 900 });
    expect(result.conflicts).toEqual(["description", "manufacturer", "price"]);
    expect(result.inventoryItemIds).toEqual(["inventory"]);
  });

  it("collapses multiple linked Inventory items deterministically and preserves Trash", () => {
    const result = mergeItemSources(
      { id: "product", description: "Fridge", deletedAt: new Date("2026-02-01") },
      [
        { id: "later", createdAt: new Date("2025-02-01"), description: "Later name" },
        { id: "earlier", createdAt: new Date("2025-01-01"), description: "Earlier name" },
      ],
    );

    expect(result.fields.description).toBe("Earlier name");
    expect(result.inventoryItemIds).toEqual(["earlier", "later"]);
    expect(result.conflicts).toContain("description");
    expect(result.deletedAt).toEqual(new Date("2026-02-01"));
  });
});
