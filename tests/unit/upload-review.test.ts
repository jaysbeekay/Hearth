import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractForImport } from "@/lib/documents/importExtraction";
import { guessDocumentType } from "@/lib/documents/classifyDocument";
import { extractContractFields } from "@/lib/documents/fieldExtraction";
import { extractInvoiceFields } from "@/lib/documents/invoiceFieldExtraction";
import { extractInventoryItemFields } from "@/lib/documents/inventoryItemFieldExtraction";
import { buildExtractionReviewItems } from "@/lib/needsAttention";
import type { Contract, Product } from "@/generated/prisma/client";

// #358 — the Upload page's one scan, and its single Needs attention row.

vi.mock("@/lib/documents/textExtraction", () => ({
  extractTextDetailed: vi.fn(async () => ({ text: "Invoice text", unavailable: false })),
}));
vi.mock("@/lib/documents/classifyDocument", () => ({ guessDocumentType: vi.fn() }));
vi.mock("@/lib/documents/fieldExtraction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/documents/fieldExtraction")>();
  return {
    ...actual,
    extractContractFields: vi.fn(async () => ({ fields: { title: "AI title" }, source: "byok" as const })),
    heuristicExtract: vi.fn(() => ({ provider: "Heuristic provider" })),
  };
});
vi.mock("@/lib/documents/invoiceFieldExtraction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/documents/invoiceFieldExtraction")>();
  return {
    ...actual,
    extractInvoiceFields: vi.fn(async () => ({ fields: { description: "Dishwasher" }, source: "byok" as const })),
    heuristicExtract: vi.fn(() => ({ manufacturer: "Bosch" })),
  };
});
vi.mock("@/lib/documents/inventoryItemFieldExtraction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/documents/inventoryItemFieldExtraction")>();
  return {
    ...actual,
    extractInventoryItemFields: vi.fn(async () => ({ fields: { label: "Couch" }, source: "byok" as const })),
    heuristicExtract: vi.fn(() => ({})),
  };
});

const buffer = Buffer.from("x");

describe("extractForImport", () => {
  beforeEach(() => vi.clearAllMocks());

  it("pre-selects the guessed type and escalates only that one", async () => {
    vi.mocked(guessDocumentType).mockReturnValue("PRODUCT");
    const scan = await extractForImport(buffer, "application/pdf", { inventoryEnabled: true, byokUser: null });
    expect(scan.guessedType).toBe("PRODUCT");
    expect(scan.results.PRODUCT).toEqual({ fields: { description: "Dishwasher" }, source: "byok" });
    // The others come from the heuristic pass over the same text: no second scan, no AI call.
    expect(scan.results.CONTRACT).toEqual({ fields: { provider: "Heuristic provider" }, source: "heuristic" });
    expect(scan.results.INVENTORY).toEqual({ fields: {}, source: "none" });
    expect(extractInvoiceFields).toHaveBeenCalledTimes(1);
    expect(extractContractFields).not.toHaveBeenCalled();
    expect(extractInventoryItemFields).not.toHaveBeenCalled();
  });

  it("falls back to Contract with no guess, and to Warranty for Inventory while that module is off", async () => {
    vi.mocked(guessDocumentType).mockReturnValue(null);
    let scan = await extractForImport(buffer, "application/pdf", { inventoryEnabled: true, byokUser: null });
    expect(scan.guessedType).toBeNull();
    expect(scan.results.CONTRACT?.source).toBe("byok");

    vi.mocked(guessDocumentType).mockReturnValue("INVENTORY");
    scan = await extractForImport(buffer, "application/pdf", { inventoryEnabled: false, byokUser: null });
    expect(scan.guessedType).toBe("PRODUCT");
    expect(scan.results.INVENTORY).toBeUndefined();
  });
});

describe("Needs attention for records waiting for a check", () => {
  const contract = (id: string) =>
    ({ id, title: `Contract ${id}`, extractionPending: true, deletedAt: null, status: "ACTIVE" }) as unknown as Contract;
  const product = (id: string) =>
    ({ id, description: `Warranty ${id}`, extractionPending: true, deletedAt: null }) as unknown as Product;

  it("keeps one record as its own row", () => {
    const items = buildExtractionReviewItems([contract("a")], []);
    expect(items).toHaveLength(1);
    expect(items[0].href).toBe("/contracts/a");
  });

  it("turns several into one row opening the Quick check screen", () => {
    const items = buildExtractionReviewItems([contract("a"), contract("b")], [product("c")]);
    expect(items).toEqual([
      expect.objectContaining({
        id: "review-batch",
        title: "3 records need a quick check",
        href: "/review",
        action: { label: "Check them", href: "/review" },
        badge: "Needs review",
      }),
    ]);
  });
});
