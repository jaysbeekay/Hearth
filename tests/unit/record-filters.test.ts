// #395 — each rule in src/lib/recordFilters.ts gives a Prisma `where` and an
// in-memory `matches`. These tests run both against the same fixture records
// in a real (temporary) SQLite database and check they select the same ones,
// plus the URL vocabulary and the old-URL mapping.
import { beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, createTestUser } from "../helpers/testDb";
import {
  contractMissingParts,
  contractRules,
  inventoryRules,
  isChipActive,
  legacyListRedirect,
  listHref,
  parseListFilters,
  parseSearchFilters,
  productMissingParts,
  productRules,
  toggleListFilter,
  vehicleMissingParts,
  vehicleRules,
  type RecordRule,
  warrantyLapsedRedirect,
} from "@/lib/recordFilters";
import { contractDueFilter } from "@/lib/listDue";

const db = setupTestDb();

let userId: string;
beforeEach(async () => {
  userId = (await createTestUser()).id;
});

const DELETED = new Date("2026-01-01T00:00:00Z");
const END = new Date("2030-01-01T00:00:00Z");

const LIVE_DOCS = { where: { deletedAt: null }, select: { isImportant: true } } as const;

function doc(name: string, extra: { isImportant?: boolean; deletedAt?: Date } = {}) {
  return { filename: `${name}.pdf`, storedName: `${name}-stored.pdf`, mimeType: "application/pdf", size: 1, ...extra };
}

async function contract(
  title: string,
  data: Partial<{
    endDate: Date | null;
    renewalType: "AUTO_RENEW" | "MANUAL_RENEWAL" | "FIXED_TERM";
    cost: number | null;
    billingFrequency: "MONTHLY" | "ONE_OFF" | null;
    status: "ACTIVE" | "CANCELLED";
    deletedAt: Date | null;
    extractionPending: boolean;
    contractNumber: string | null;
    docs: ReturnType<typeof doc>[];
  }> = {},
) {
  const { docs, ...fields } = data;
  return db.prisma.contract.create({
    data: {
      title,
      category: "OTHER",
      provider: "Provider",
      createdById: userId,
      endDate: END,
      ...fields,
      ...(docs ? { documents: { create: docs } } : {}),
    },
  });
}

/** Titles the `where` selects and titles `matches` selects, from the same rows. */
async function contractSelections<Row>(
  rule: RecordRule<object, Row>,
) {
  const viaWhere = await db.prisma.contract.findMany({ where: rule.where, select: { title: true } });
  const all = await db.prisma.contract.findMany({ include: { documents: LIVE_DOCS } });
  const viaMatches = all.filter((row) => rule.matches(row as unknown as Row));
  return {
    where: viaWhere.map((r) => r.title).sort(),
    matches: viaMatches.map((r) => r.title).sort(),
  };
}

describe("Contract rules", () => {
  beforeEach(async () => {
    await contract("complete", { cost: 20, billingFrequency: "MONTHLY", docs: [doc("a", { isImportant: true })] });
    await contract("no end date", { endDate: null, extractionPending: true });
    await contract("no end date, auto-renews", { endDate: null, renewalType: "AUTO_RENEW", docs: [doc("b"), doc("c", { isImportant: true, deletedAt: DELETED })] });
    await contract("no end date, fixed term", { endDate: null, renewalType: "FIXED_TERM" });
    await contract("cost, no frequency", { cost: 15, billingFrequency: null, docs: [doc("d", { deletedAt: DELETED })] });
    await contract("zero cost, no frequency", { cost: 0, billingFrequency: null });
    await contract("one-off cost", { cost: 99, billingFrequency: "ONE_OFF" });
    await contract("no contract number", { contractNumber: null });
    await contract("cancelled, no end date", { endDate: null, status: "CANCELLED", cost: 5, extractionPending: true });
    await contract("deleted, no end date", { endDate: null, deletedAt: DELETED, extractionPending: true, docs: [doc("e", { isImportant: true })] });
  });

  it("Missing key details: query and in-memory check agree", async () => {
    const sel = await contractSelections(contractRules.missingDetails);
    expect(sel.where).toEqual(["cost, no frequency", "no end date", "no end date, fixed term", "zero cost, no frequency"]);
    expect(sel.matches).toEqual(sel.where);
  });

  it("Needs review: query and in-memory check agree", async () => {
    const sel = await contractSelections(contractRules.review);
    expect(sel.where).toEqual(["cancelled, no end date", "no end date"]);
    expect(sel.matches).toEqual(sel.where);
  });

  it("No Document: soft-deleted Documents don't count", async () => {
    const sel = await contractSelections(contractRules.noDocument);
    expect(sel.where).toEqual([
      "cancelled, no end date",
      "cost, no frequency",
      "no contract number",
      "no end date",
      "no end date, fixed term",
      "one-off cost",
      "zero cost, no frequency",
    ]);
    expect(sel.matches).toEqual(sel.where);
  });

  it("Important: only a live, starred Document counts", async () => {
    const sel = await contractSelections(contractRules.important);
    expect(sel.where).toEqual(["complete"]);
    expect(sel.matches).toEqual(sel.where);
  });

  it("says which part is missing", () => {
    const base = { deletedAt: null, status: "ACTIVE", renewalType: "MANUAL_RENEWAL", endDate: null, cost: 10, billingFrequency: null };
    expect(contractMissingParts(base)).toEqual(["No end date", "No billing frequency"]);
    expect(contractMissingParts({ ...base, status: "CANCELLED" })).toEqual([]);
    expect(contractMissingParts({ ...base, renewalType: "AUTO_RENEW", cost: null })).toEqual([]);
  });
});

describe("Contract Due filter (the Due policy, #384)", () => {
  it("leaves Cancelled Contracts out", async () => {
    const ctx = { today: "2026-10-25", defaultReminderDays: "30,14,7,1" };
    const inTen = new Date("2026-11-04T00:00:00Z");
    const tenAgo = new Date("2026-10-15T00:00:00Z");
    await contract("soon", { endDate: inTen });
    await contract("soon, cancelled", { endDate: inTen, status: "CANCELLED" });
    await contract("overdue", { endDate: tenAgo });
    await contract("overdue, cancelled", { endDate: tenAgo, status: "CANCELLED" });
    await contract("far", { endDate: END });

    for (const [due, expected] of [["soon", ["soon"]], ["overdue", ["overdue"]]] as const) {
      const f = contractDueFilter(due, ctx);
      const rows = await db.prisma.contract.findMany({ where: f.where });
      expect(rows.filter(f.matches).map((r) => r.title)).toEqual(expected);
      const all = await db.prisma.contract.findMany();
      expect(all.filter(f.matches).map((r) => r.title)).toEqual(expected);
    }
  });
});

describe("Vehicle rules", () => {
  it("Missing key details means no VIN and no plate", async () => {
    const make = (label: string, data: { vin?: string; licensePlate?: string; deletedAt?: Date } = {}) =>
      db.prisma.vehicle.create({ data: { label, createdById: userId, ...data } });
    await make("vin only", { vin: "1HGCM82633A123456" });
    await make("plate only", { licensePlate: "ABC123" });
    await make("both", { vin: "1HGCM82633A654321", licensePlate: "XYZ789" });
    await make("neither");
    await make("neither, deleted", { deletedAt: DELETED });

    const viaWhere = await db.prisma.vehicle.findMany({ where: vehicleRules.missingDetails.where });
    const all = await db.prisma.vehicle.findMany();
    expect(viaWhere.map((v) => v.label)).toEqual(["neither"]);
    expect(all.filter(vehicleRules.missingDetails.matches).map((v) => v.label)).toEqual(["neither"]);
    expect(vehicleMissingParts(viaWhere[0])).toEqual(["No VIN or plate"]);
  });
});

describe("Warranty and Inventory item rules (unchanged until #380)", () => {
  it("Warranty rules: query and in-memory check agree", async () => {
    const make = (description: string, data: Record<string, unknown> = {}) =>
      db.prisma.product.create({ data: { description, createdById: userId, warrantyEndDate: END, serialNumber: "S1", ...data } });
    await make("complete", { documents: { create: [doc("p1", { isImportant: true })] } });
    await make("no end date", { warrantyEndDate: null, extractionPending: true });
    await make("barcode only", { serialNumber: null, barcode: "123" });
    await make("no identifier", { serialNumber: null });
    await make("deleted", { deletedAt: DELETED, warrantyEndDate: null, extractionPending: true });
    await make("old document", { documents: { create: [doc("p2", { isImportant: true, deletedAt: DELETED })] } });

    const all = await db.prisma.product.findMany({ include: { documents: LIVE_DOCS } });
    for (const [rule, expected] of [
      [productRules.missingDetails, ["no end date", "no identifier"]],
      [productRules.review, ["no end date"]],
      [productRules.noDocument, ["barcode only", "no end date", "no identifier", "old document"]],
      [productRules.important, ["complete"]],
    ] as const) {
      const viaWhere = await db.prisma.product.findMany({ where: rule.where });
      expect(viaWhere.map((p) => p.description).sort()).toEqual(expected);
      expect(all.filter((p) => (rule.matches as (row: typeof p) => boolean)(p)).map((p) => p.description).sort()).toEqual(expected);
    }
    expect(productMissingParts({ deletedAt: null, warrantyEndDate: null, serialNumber: null, barcode: null })).toEqual([
      "No warranty end date",
      "No serial number or barcode",
    ]);
  });

  it("Inventory item rule: query and in-memory check agree", async () => {
    const make = (label: string, data: Record<string, unknown> = {}) =>
      db.prisma.inventoryItem.create({ data: { label, createdById: userId, ...data } });
    await make("has serial", { serialNumber: "X" });
    await make("no serial");
    await make("no serial, deleted", { deletedAt: DELETED });
    const viaWhere = await db.prisma.inventoryItem.findMany({ where: inventoryRules.missingDetails.where });
    const all = await db.prisma.inventoryItem.findMany();
    expect(viaWhere.map((i) => i.label)).toEqual(["no serial"]);
    expect(all.filter(inventoryRules.missingDetails.matches).map((i) => i.label)).toEqual(["no serial"]);
  });
});

describe("URL vocabulary", () => {
  it("parses and writes the canonical parameters", () => {
    const filters = parseListFilters(new URLSearchParams("due=soon&missing=details&review=1&noDocument=1&important=1&q=x"));
    expect(filters).toEqual({ due: "soon", missingDetails: true, review: true, noDocument: true, important: true });
    expect(listHref("/contracts", filters, { q: "x", category: undefined })).toBe(
      "/contracts?q=x&due=soon&missing=details&review=1&noDocument=1&important=1",
    );
    expect(listHref("/contracts", {})).toBe("/contracts");
    expect(parseListFilters({ due: "later", missing: "yes", review: "true" })).toEqual({});
  });

  it("toggles chips, with Due soon and overdue sharing ?due=", () => {
    const soon = toggleListFilter({}, "dueSoon");
    expect(soon).toEqual({ due: "soon" });
    expect(toggleListFilter(soon, "overdue")).toEqual({ due: "overdue" });
    expect(toggleListFilter(soon, "dueSoon").due).toBeUndefined();
    const missing = toggleListFilter(soon, "missingDetails");
    expect(isChipActive(missing, "missingDetails")).toBe(true);
    expect(isChipActive(toggleListFilter(missing, "missingDetails"), "missingDetails")).toBe(false);
  });
});

describe("old URLs map onto the new ones", () => {
  it.each([
    ["expiring=30", "/contracts?due=soon"],
    ["expiring=7", "/contracts?due=soon"],
    ["expired=true", "/contracts?due=overdue"],
    ["missingInfo=true", "/contracts?missing=details"],
    ["needsReview=true", "/contracts?review=1"],
    ["missingDocument=true", "/contracts?noDocument=1"],
    ["q=car&category=INSURANCE&status=ACTIVE&expiring=30&missingDocument=true", "/contracts?q=car&category=INSURANCE&status=ACTIVE&due=soon&noDocument=1"],
    ["expiring=abc", "/contracts"],
    ["missingInfo=false&q=x", "/contracts?q=x"],
  ])("?%s → %s", (query, expected) => {
    expect(legacyListRedirect("/contracts", new URLSearchParams(query))).toBe(expected);
  });

  it("leaves new-style URLs alone", () => {
    expect(legacyListRedirect("/contracts", new URLSearchParams("due=soon&q=x"))).toBeNull();
    expect(legacyListRedirect("/contracts", {})).toBeNull();
  });

  it("accepts a Next.js searchParams object", () => {
    expect(legacyListRedirect("/products", { expired: "true", q: ["a", "b"] })).toBe("/products?q=a&q=b&due=lapsed");
  });

  it.each([
    ["filter=expiring", { due: "soon" }],
    ["filter=needsReview", { review: true }],
    ["filter=noDocument", { noDocument: true }],
    ["filter=important", { important: true }],
    ["filter=missingDate", { missingDetails: true }],
    ["filter=missingIdentifier", { missingDetails: true }],
    ["filter=missingReminder", {}],
    ["filter=missingRelationship", {}],
    ["missing=details", { missingDetails: true }],
  ])("Search ?%s", (query, expected) => {
    expect(parseSearchFilters(new URLSearchParams(query))).toEqual(expected);
  });
});

describe("?due=lapsed (#384)", () => {
  it("is its own URL word, sharing ?due= with the Due chips", () => {
    expect(parseListFilters(new URLSearchParams("due=lapsed"))).toEqual({ due: "lapsed" });
    expect(toggleListFilter({ due: "soon" }, "lapsed")).toEqual({ due: "lapsed" });
    expect(toggleListFilter({ due: "lapsed" }, "lapsed")).toEqual({ due: undefined });
    expect(isChipActive({ due: "lapsed" }, "lapsed")).toBe(true);
    expect(isChipActive({ due: "lapsed" }, "overdue")).toBe(false);
  });

  it("old Warranties links to the Lapsed chip land on ?due=lapsed", () => {
    expect(warrantyLapsedRedirect(new URLSearchParams("q=tv&due=overdue"))).toBe("/products?q=tv&due=lapsed");
    expect(warrantyLapsedRedirect(new URLSearchParams("due=soon"))).toBeNull();
    expect(legacyListRedirect("/products", { expired: "true" })).toBe("/products?due=lapsed");
    expect(legacyListRedirect("/contracts", { expired: "true" })).toBe("/contracts?due=overdue");
  });
});
