import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { setupTestDb, createTestUser, setModuleEnabled } from "../helpers/testDb";
import {
  createTripCommand,
  createTripSegmentCommand,
  deleteTripSegmentCommand,
  restoreTripSegmentCommand,
} from "@/lib/commands/trips";
import {
  createPropertyCommand,
  createTenancyCommand,
  createRentalStatementCommand,
  deleteRentalStatementCommand,
  restoreRentalStatementCommand,
  createPropertyValuationCommand,
  deletePropertyValuationCommand,
  restorePropertyValuationCommand,
} from "@/lib/commands/home";
import {
  createPortfolioCommand,
  createHoldingCommand,
  createTradeCommand,
  deleteTradeCommand,
  restoreTradeCommand,
} from "@/lib/commands/wealth";
import {
  addDocumentCommand,
  deleteDocumentCommand,
  restoreDocumentCommand,
  setDocumentImportantCommand,
  findDocument,
  isDocumentOwnerInTrash,
} from "@/lib/commands/documents";
import { RecordNotFoundError } from "@/lib/commands/shared";
import { LIVE_DOCUMENT_WHERE } from "@/lib/documents/liveDocuments";
import { getTrashEntries } from "@/lib/trash";
import { getNetWorth } from "@/lib/wealth";
import { propertySchema, rentalStatementSchema, rentalAgreementSchema } from "@/lib/validation/home";
import { holdingSchema, portfolioSchema, tradeSchema } from "@/lib/validation/wealth";
import { auth } from "@/lib/auth";

// #427: Trip segments, Rental statements, Trades, Tenancies and Property
// valuations go to Trash. These cover what's shared across them: their
// Documents follow their Trash state, offline deletes sync to Trash, Trash
// lists them, and a Trade or valuation in Trash leaves the Wealth totals.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
// No network: a looked-up market price for a new Trade is best-effort.
vi.mock("@/lib/prices", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/prices")>()),
  fetchHistoricalPrice: vi.fn(async () => null),
}));

const db = setupTestDb();

let actorId: string;

beforeEach(async () => {
  vi.clearAllMocks();
  actorId = (await createTestUser()).id;
  vi.mocked(auth).mockResolvedValue({ user: { id: actorId, role: "MEMBER" } } as never);
  for (const key of ["TRAVEL", "HOME", "WEALTH"] as const) await setModuleEnabled(key, true);
});

function pdf() {
  return new File(["%PDF-1.4\n% test document\n"], "receipt.pdf", { type: "application/pdf" });
}

async function newSegment() {
  const trip = await createTripCommand({ title: "Japan" }, actorId);
  return createTripSegmentCommand(trip.id, { type: "FLIGHT", title: "SYD → NRT", currency: "AUD" });
}

async function newProperty() {
  return createPropertyCommand(propertySchema.parse({ label: "Flat" }), actorId);
}

async function newStatement(propertyId?: string) {
  const id = propertyId ?? (await newProperty()).id;
  return createRentalStatementCommand(id, rentalStatementSchema.parse({ grossRent: 2200 }));
}

async function newHolding() {
  const portfolio = await createPortfolioCommand(portfolioSchema.parse({ name: "Shares" }), actorId);
  const holding = await createHoldingCommand(portfolio.id, holdingSchema.parse({ ticker: "VAS.AX" }));
  return { portfolio, holding };
}

async function newTrade(holdingId: string, units = 10) {
  return createTradeCommand(holdingId, tradeSchema.parse({ type: "BUY", date: "2025-01-02", units, pricePerUnit: 100 }));
}

describe("Documents of an entry in Trash", () => {
  it("can't be added, starred or restored until the entry is restored", async () => {
    const segment = await newSegment();
    const statement = await newStatement();
    const { holding } = await newHolding();
    const trade = await newTrade(holding.id);

    const owners = [
      { kind: "TRIP_SEGMENT" as const, id: segment.id, trash: deleteTripSegmentCommand, restore: restoreTripSegmentCommand, label: "segment" },
      { kind: "RENTAL_STATEMENT" as const, id: statement.id, trash: deleteRentalStatementCommand, restore: restoreRentalStatementCommand, label: "rental statement" },
      { kind: "TRADE" as const, id: trade.id, trash: deleteTradeCommand, restore: restoreTradeCommand, label: "trade" },
    ];

    for (const owner of owners) {
      const kept = await addDocumentCommand(owner.kind, owner.id, { file: pdf() });
      const binned = await addDocumentCommand(owner.kind, owner.id, { file: pdf() });
      await deleteDocumentCommand(owner.kind, binned.id);
      await owner.trash(owner.id);

      await expect(addDocumentCommand(owner.kind, owner.id, { file: pdf() })).rejects.toBeInstanceOf(
        RecordNotFoundError,
      );
      await expect(setDocumentImportantCommand(owner.kind, kept.id, true)).rejects.toBeInstanceOf(RecordNotFoundError);
      await expect(restoreDocumentCommand(owner.kind, binned.id)).rejects.toThrow(`Restore the ${owner.label} first.`);
      // Not served, and left out of every Document list.
      expect(await isDocumentOwnerInTrash((await findDocument(owner.kind, kept.id))!)).toBe(true);

      // The entry's own delete leaves its Documents' Trash state alone.
      expect((await findDocument(owner.kind, kept.id))!.deletedAt).toBeNull();

      await owner.restore(owner.id);
      await setDocumentImportantCommand(owner.kind, kept.id, true);
      await restoreDocumentCommand(owner.kind, binned.id);
      expect(await isDocumentOwnerInTrash((await findDocument(owner.kind, kept.id))!)).toBe(false);
    }
    expect(await db.prisma.tripSegmentDocument.count({ where: LIVE_DOCUMENT_WHERE.TRIP_SEGMENT })).toBe(2);
    expect(await db.prisma.rentalStatementDocument.count({ where: LIVE_DOCUMENT_WHERE.RENTAL_STATEMENT })).toBe(2);
    expect(await db.prisma.tradeDocument.count({ where: LIVE_DOCUMENT_WHERE.TRADE })).toBe(2);
  });

  it("are left out of the live Document lists while the entry is in Trash", async () => {
    const { holding } = await newHolding();
    const trade = await newTrade(holding.id);
    await addDocumentCommand("TRADE", trade.id, { file: pdf() });
    await deleteTradeCommand(trade.id);
    expect(await db.prisma.tradeDocument.count({ where: LIVE_DOCUMENT_WHERE.TRADE })).toBe(0);
    await restoreTradeCommand(trade.id);
    expect(await db.prisma.tradeDocument.count({ where: LIVE_DOCUMENT_WHERE.TRADE })).toBe(1);
  });
});

describe("Wealth totals", () => {
  it("leave out a Trade or a Property valuation in Trash, and count it again once restored", async () => {
    const { portfolio, holding } = await newHolding();
    await newTrade(holding.id, 10);
    const second = await newTrade(holding.id, 5);
    const property = await newProperty();
    const valuation = await createPropertyValuationCommand(property.id, {
      valuedAt: new Date(),
      value: 900_000,
      currency: "AUD",
    });
    const modules = new Set(["WEALTH", "HOME"] as const);
    const position = async () => {
      const data = await getNetWorth(modules);
      const held = data.portfolios.find((p) => p.portfolioId === portfolio.id)!.holdings[0];
      return { units: held.unitsHeld, cost: held.costBasis, propertyValue: data.propertyValue };
    };

    expect(await position()).toEqual({ units: 15, cost: 1500, propertyValue: 900_000 });

    await deleteTradeCommand(second.id);
    await deletePropertyValuationCommand(valuation.id);
    expect(await position()).toEqual({ units: 10, cost: 1000, propertyValue: 0 });

    await restoreTradeCommand(second.id);
    await restorePropertyValuationCommand(valuation.id);
    expect(await position()).toEqual({ units: 15, cost: 1500, propertyValue: 900_000 });
  });
});

describe("Trash", () => {
  it("lists each kind of entry with what it's under", async () => {
    const segment = await newSegment();
    const property = await newProperty();
    const statement = await createRentalStatementCommand(
      property.id,
      rentalStatementSchema.parse({ grossRent: 2200, statementDate: "2026-03-31" }),
    );
    const tenancy = await createTenancyCommand(
      property.id,
      rentalAgreementSchema.parse({ weeklyRent: 550, tenantName: "Sam" }),
      actorId,
    );
    const valuation = await createPropertyValuationCommand(property.id, {
      valuedAt: new Date("2026-06-01T00:00:00Z"),
      value: 900_000,
      currency: "AUD",
    });
    const { holding } = await newHolding();
    const trade = await newTrade(holding.id);

    const { POST } = await import("@/app/api/sync/route");
    const body = new FormData();
    body.append(
      "operations",
      JSON.stringify([
        { id: "op-1", entity: "tripSegment", operation: "delete", entityId: segment.id, parentId: segment.tripId },
        { id: "op-2", entity: "rentalStatement", operation: "delete", entityId: statement.id, parentId: property.id },
        { id: "op-3", entity: "rentalAgreement", operation: "delete", entityId: tenancy.id, parentId: property.id },
        { id: "op-4", entity: "propertyValuation", operation: "delete", entityId: valuation.id, parentId: property.id },
        { id: "op-5", entity: "trade", operation: "delete", entityId: trade.id, parentId: holding.id },
      ]),
    );
    const response = await POST(new NextRequest("http://localhost/api/sync", { method: "POST", body }));
    const { results } = (await response.json()) as { results: { success: boolean }[] };
    expect(results.every((r) => r.success)).toBe(true);

    // An offline delete moves each to Trash rather than deleting it.
    const entries = await getTrashEntries("YYYY-MM-DD");
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: segment.id, domain: "tripSegment", label: "SYD → NRT", subtitle: "Japan" }),
        expect.objectContaining({ id: statement.id, domain: "rentalStatement", label: "Statement 2026-03-31", subtitle: "Flat" }),
        expect.objectContaining({ id: tenancy.id, domain: "tenancy", label: "Sam", subtitle: "Flat" }),
        expect.objectContaining({ id: valuation.id, domain: "propertyValuation", label: "$900,000.00 on 2026-06-01", subtitle: "Flat" }),
        expect.objectContaining({ id: trade.id, domain: "trade", label: "Buy 10 VAS.AX", subtitle: "2025-01-02" }),
      ]),
    );
    expect(await db.prisma.tripSegment.count()).toBe(1);
    expect(await db.prisma.trade.count()).toBe(1);
  });

  it("leaves out entries of a module that's turned off", async () => {
    const segment = await newSegment();
    const { holding } = await newHolding();
    const trade = await newTrade(holding.id);
    await deleteTripSegmentCommand(segment.id);
    await deleteTradeCommand(trade.id);

    await setModuleEnabled("TRAVEL", false);
    const ids = (await getTrashEntries()).map((entry) => entry.id);
    expect(ids).toContain(trade.id);
    expect(ids).not.toContain(segment.id);

    await setModuleEnabled("TRAVEL", true);
    expect((await getTrashEntries()).map((entry) => entry.id)).toContain(segment.id);
  });

  it("reports an offline delete scoped to the wrong parent as failed", async () => {
    const statement = await newStatement();
    const { POST } = await import("@/app/api/sync/route");
    const body = new FormData();
    body.append(
      "operations",
      JSON.stringify([{ id: "op-1", entity: "rentalStatement", operation: "delete", entityId: statement.id, parentId: "other" }]),
    );
    const response = await POST(new NextRequest("http://localhost/api/sync", { method: "POST", body }));
    expect(await response.json()).toEqual({
      results: [{ id: "op-1", success: false, error: "Rental statement not found" }],
    });
    expect((await db.prisma.rentalStatement.findUniqueOrThrow({ where: { id: statement.id } })).deletedAt).toBeNull();
  });
});
