import { describe, expect, it } from "vitest";
import { readItemDocument, removeItemDocumentFiles } from "@/lib/storage";

// #445 Codacy finding (storage.ts itemDir): an Item id only ever reaches a
// path after it matches the generated-id pattern.
describe("Item document storage path", () => {
  it.each(["..", "../etc", "a/b", "a\\b", "", "x".repeat(65)])("refuses item id %j", async (id) => {
    await expect(readItemDocument(id, "file.pdf")).rejects.toThrow("Invalid item id");
    await expect(removeItemDocumentFiles(id)).rejects.toThrow("Invalid item id");
  });

  it("accepts a generated id", async () => {
    await expect(removeItemDocumentFiles("3f2c9a1e-7b4d-4e0a-9c1f-2d6b8e5a7c90")).resolves.not.toThrow();
  });
});
