import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser, setModuleEnabled } from "../helpers/testDb";
import {
  createPortfolioCommand,
  updatePortfolioCommand,
  permanentlyDeletePortfolioCommand,
  createHoldingCommand,
  updateHoldingCommand,
  permanentlyDeleteHoldingCommand,
  createTradeCommand,
  updateTradeCommand,
  permanentlyDeleteTradeCommand,
  saveTradeMarketPrice,
  importTradesCommand,
  DuplicateHoldingError,
} from "@/lib/commands/wealth";
import { RecordNotFoundError, StaleEditError } from "@/lib/commands/shared";
import { ModuleDisabledError } from "@/lib/modules/enablement";
import { fullFormUpdate } from "@/lib/validation/fullFormUpdate";
import { portfolioSchema, holdingSchema, tradeSchema, type TradeInput } from "@/lib/validation/wealth";
import { formToPortfolioInput, formToHoldingInput, formToTradeInput } from "@/lib/formMappers";
import { holdingUnitsAndCost } from "@/lib/wealth";
import {
  createPortfolio,
  updatePortfolio,
  deletePortfolio,
  createHolding,
  updateHolding,
  deleteHolding,
  createTrade,
  updateTrade,
  deleteTrade,
  importTrades,
} from "@/lib/actions/wealth";
import { fetchHistoricalPrice } from "@/lib/prices";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
// The market-price backfill after a create; no network in tests.
vi.mock("@/lib/prices", () => ({ fetchHistoricalPrice: vi.fn(async () => null) }));

const db = setupTestDb();

let actorId: string;

beforeEach(async () => {
  vi.clearAllMocks();
  actorId = (await createTestUser()).id;
  await setModuleEnabled("WEALTH", true);
});

async function exists(p: string) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// Puts a file where storage.ts keeps a Trade's Documents, plus the row
// pointing at it, so a permanent delete has something real to clean up.
async function attachFile(tradeId: string, options: { storedName?: string; deletedAt?: Date } = {}) {
  const storedName = options.storedName ?? "contract-note.pdf";
  const dir = path.join(db.uploadsDir, "trades", tradeId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, storedName), "%PDF-1.4 test");
  await db.prisma.tradeDocument.create({
    data: {
      tradeId,
      filename: "note.pdf",
      storedName,
      mimeType: "application/pdf",
      size: 13,
      deletedAt: options.deletedAt,
    },
  });
  return dir;
}

function formData(values: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.append(key, value);
  return fd;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

const newPortfolio = (name = "Super", extra: Partial<{ description: string; costMethod: "FIFO" | "AVERAGE" }> = {}) =>
  createPortfolioCommand(portfolioSchema.parse({ name, ...extra }), actorId);

const newHolding = (portfolioId: string, ticker = "VAS.AX", extra: Record<string, string> = {}) =>
  createHoldingCommand(portfolioId, holdingSchema.parse({ ticker, ...extra }));

const buy = (units: number, price: number, date: string, extra: Partial<TradeInput> = {}): TradeInput =>
  tradeSchema.parse({ type: "BUY", date, units, pricePerUnit: price, ...extra });

describe("Portfolio commands", () => {
  it("creates a Portfolio with the actor as creator and revalidates Wealth", async () => {
    const portfolio = await newPortfolio("Super", { costMethod: "AVERAGE" });
    expect(await db.prisma.portfolio.findUniqueOrThrow({ where: { id: portfolio.id } })).toMatchObject({
      name: "Super",
      currency: "AUD",
      costMethod: "AVERAGE",
      createdById: actorId,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/wealth");
    expect(revalidatePath).toHaveBeenCalledWith(`/wealth/portfolios/${portfolio.id}`);
  });

  it("applies a partial patch, leaving other fields alone", async () => {
    const portfolio = await newPortfolio("Super", { description: "Mine" });
    await updatePortfolioCommand(portfolio.id, { costMethod: "AVERAGE" });
    expect(await db.prisma.portfolio.findUniqueOrThrow({ where: { id: portfolio.id } })).toMatchObject({
      name: "Super",
      description: "Mine",
      costMethod: "AVERAGE",
    });
  });

  it("clears the fields a full edit form submitted blank", async () => {
    const portfolio = await newPortfolio("Super", { description: "Mine" });
    const submission = formData({ name: "Super", description: "", currency: "AUD", costMethod: "FIFO" });
    const parsed = portfolioSchema.parse(formToPortfolioInput(submission));
    await updatePortfolioCommand(portfolio.id, fullFormUpdate(portfolioSchema, parsed, submission));
    expect((await db.prisma.portfolio.findUniqueOrThrow({ where: { id: portfolio.id } })).description).toBeNull();
  });

  it("refuses a stale edit and a missing Portfolio", async () => {
    const portfolio = await newPortfolio();
    await tick();
    await updatePortfolioCommand(portfolio.id, { name: "First" }, { baseUpdatedAt: portfolio.updatedAt });
    await expect(
      updatePortfolioCommand(portfolio.id, { name: "Second" }, { baseUpdatedAt: portfolio.updatedAt.toISOString() }),
    ).rejects.toBeInstanceOf(StaleEditError);
    expect((await db.prisma.portfolio.findUniqueOrThrow({ where: { id: portfolio.id } })).name).toBe("First");
    await expect(updatePortfolioCommand("missing", { name: "x" })).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(permanentlyDeletePortfolioCommand("missing")).rejects.toBeInstanceOf(RecordNotFoundError);
  });

  it("permanently deletes the Portfolio with its Holdings, Trades and Trade files", async () => {
    const portfolio = await newPortfolio();
    const holding = await newHolding(portfolio.id);
    const trade = await createTradeCommand(holding.id, buy(10, 100, "2025-01-02"));
    const dir = await attachFile(trade.id);
    await attachFile(trade.id, { storedName: "in-trash.pdf", deletedAt: new Date() });
    const keep = await newPortfolio("Other");
    const keepTrade = await createTradeCommand((await newHolding(keep.id)).id, buy(1, 1, "2025-01-02"));
    const keepDir = await attachFile(keepTrade.id);

    await permanentlyDeletePortfolioCommand(portfolio.id);

    expect(await db.prisma.portfolio.findUnique({ where: { id: portfolio.id } })).toBeNull();
    expect(await db.prisma.holding.count({ where: { portfolioId: portfolio.id } })).toBe(0);
    expect(await db.prisma.trade.count({ where: { holdingId: holding.id } })).toBe(0);
    expect(await db.prisma.tradeDocument.count({ where: { tradeId: trade.id } })).toBe(0);
    expect(await exists(dir)).toBe(false);
    expect(await exists(path.join(keepDir, "contract-note.pdf"))).toBe(true);
    expect(await db.prisma.trade.count()).toBe(1);
  });
});

describe("Holding commands", () => {
  it("creates a Holding under its Portfolio and refuses a ticker already there", async () => {
    const portfolio = await newPortfolio();
    const holding = await newHolding(portfolio.id, "vgs.ax", { name: "Vanguard" });
    expect(holding).toMatchObject({ portfolioId: portfolio.id, ticker: "VGS.AX", name: "Vanguard", assetClass: "SHARE" });
    expect(revalidatePath).toHaveBeenCalledWith(`/wealth/portfolios/${portfolio.id}/holdings/${holding.id}`);
    await expect(newHolding(portfolio.id, "VGS.AX")).rejects.toThrow("VGS.AX is already in this portfolio.");
    // The same ticker in another Portfolio is fine.
    await newHolding((await newPortfolio("Other")).id, "VGS.AX");
  });

  it("refuses a Holding under a Portfolio that's gone (#428)", async () => {
    const portfolio = await newPortfolio();
    await permanentlyDeletePortfolioCommand(portfolio.id);
    await expect(newHolding(portfolio.id)).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(newHolding("missing")).rejects.toBeInstanceOf(RecordNotFoundError);
    expect(await db.prisma.holding.count()).toBe(0);
  });

  it("applies a partial patch and a full-form clear", async () => {
    const portfolio = await newPortfolio();
    const holding = await newHolding(portfolio.id, "BTC-AUD", { name: "Bitcoin", exchange: "CRYPTO", assetClass: "CRYPTO" });
    await updateHoldingCommand(holding.id, { name: "BTC" });
    expect(await db.prisma.holding.findUniqueOrThrow({ where: { id: holding.id } })).toMatchObject({
      ticker: "BTC-AUD",
      name: "BTC",
      exchange: "CRYPTO",
    });

    const submission = formData({ ticker: "BTC-AUD", name: "", assetClass: "CRYPTO", exchange: "" });
    const parsed = holdingSchema.parse(formToHoldingInput(submission));
    await updateHoldingCommand(holding.id, fullFormUpdate(holdingSchema, parsed, submission), { portfolioId: portfolio.id });
    expect(await db.prisma.holding.findUniqueOrThrow({ where: { id: holding.id } })).toMatchObject({
      name: null,
      exchange: null,
      assetClass: "CRYPTO",
    });
  });

  it("refuses a ticker change onto another Holding, an out-of-scope edit and a stale edit", async () => {
    const portfolio = await newPortfolio();
    const vas = await newHolding(portfolio.id, "VAS.AX");
    await newHolding(portfolio.id, "VGS.AX");
    await expect(updateHoldingCommand(vas.id, { ticker: "VGS.AX" })).rejects.toBeInstanceOf(DuplicateHoldingError);
    // Keeping its own ticker isn't a clash.
    await updateHoldingCommand(vas.id, { ticker: "VAS.AX", name: "Aussie shares" });

    const other = await newPortfolio("Other");
    await expect(updateHoldingCommand(vas.id, { name: "x" }, { portfolioId: other.id })).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );

    const loaded = await db.prisma.holding.findUniqueOrThrow({ where: { id: vas.id } });
    await tick();
    await updateHoldingCommand(vas.id, { name: "First" }, { baseUpdatedAt: loaded.updatedAt });
    await expect(updateHoldingCommand(vas.id, { name: "Second" }, { baseUpdatedAt: loaded.updatedAt })).rejects.toBeInstanceOf(
      StaleEditError,
    );
    expect((await db.prisma.holding.findUniqueOrThrow({ where: { id: vas.id } })).name).toBe("First");
  });

  it("permanently deletes the Holding with its Trades and their files, in scope only", async () => {
    const portfolio = await newPortfolio();
    const holding = await newHolding(portfolio.id);
    const trade = await createTradeCommand(holding.id, buy(5, 90, "2025-03-01"));
    const dir = await attachFile(trade.id);

    await expect(permanentlyDeleteHoldingCommand(holding.id, { portfolioId: "other" })).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
    expect(await exists(dir)).toBe(true);

    expect(await permanentlyDeleteHoldingCommand(holding.id, { portfolioId: portfolio.id })).toEqual({
      portfolioId: portfolio.id,
    });
    expect(await db.prisma.holding.findUnique({ where: { id: holding.id } })).toBeNull();
    expect(await db.prisma.trade.count()).toBe(0);
    expect(await db.prisma.tradeDocument.count()).toBe(0);
    expect(await exists(dir)).toBe(false);
    expect(await db.prisma.portfolio.findUnique({ where: { id: portfolio.id } })).not.toBeNull();
  });
});

describe("Trade commands", () => {
  let portfolioId: string;
  let holdingId: string;

  beforeEach(async () => {
    portfolioId = (await newPortfolio()).id;
    holdingId = (await newHolding(portfolioId)).id;
  });

  it("creates a Trade, revalidates its Holding and back-fills the market price without touching updatedAt", async () => {
    vi.mocked(fetchHistoricalPrice).mockResolvedValueOnce(101.5);
    const trade = await createTradeCommand(holdingId, buy(10, 100, "2025-01-02", { fees: 9.5 }));
    expect(trade).toMatchObject({ holdingId, type: "BUY", units: 10, pricePerUnit: 100, fees: 9.5 });
    expect(fetchHistoricalPrice).toHaveBeenCalledWith("VAS.AX", new Date("2025-01-02"));
    await vi.waitFor(async () => {
      expect((await db.prisma.trade.findUniqueOrThrow({ where: { id: trade.id } })).marketPriceOnDate).toBe(101.5);
    });
    expect((await db.prisma.trade.findUniqueOrThrow({ where: { id: trade.id } })).updatedAt).toEqual(trade.updatedAt);
    expect(revalidatePath).toHaveBeenCalledWith(`/wealth/portfolios/${portfolioId}/holdings/${holdingId}`);
    expect(revalidatePath).toHaveBeenCalledWith("/wealth");
  });

  it("doesn't look up a price for a crypto Holding", async () => {
    const crypto = await newHolding(portfolioId, "BTC-AUD", { exchange: "CRYPTO", assetClass: "CRYPTO" });
    await createTradeCommand(crypto.id, buy(1, 50_000, "2025-01-02"));
    expect(fetchHistoricalPrice).not.toHaveBeenCalled();
  });

  it("saveTradeMarketPrice reports a missing Trade instead of throwing", async () => {
    expect(await saveTradeMarketPrice("missing", 1)).toBe(false);
  });

  it("refuses a Trade under a Holding that's gone (#428)", async () => {
    await permanentlyDeleteHoldingCommand(holdingId);
    await expect(createTradeCommand(holdingId, buy(1, 1, "2025-01-02"))).rejects.toBeInstanceOf(RecordNotFoundError);
    expect(await db.prisma.trade.count()).toBe(0);
  });

  it("applies a partial patch and a full-form clear", async () => {
    const trade = await createTradeCommand(holdingId, buy(10, 100, "2025-01-02", { fees: 9.5, notes: "First lot", fxRate: 1.5 }));
    await updateTradeCommand(trade.id, { units: 12 });
    expect(await db.prisma.trade.findUniqueOrThrow({ where: { id: trade.id } })).toMatchObject({
      units: 12,
      pricePerUnit: 100,
      fees: 9.5,
      notes: "First lot",
    });

    const submission = formData({
      type: "BUY",
      date: "2025-01-02",
      units: "12",
      pricePerUnit: "100",
      fees: "",
      currency: "AUD",
      fxRate: "",
      notes: "",
    });
    const parsed = tradeSchema.parse(formToTradeInput(submission));
    await updateTradeCommand(trade.id, fullFormUpdate(tradeSchema, parsed, submission), { holdingId });
    expect(await db.prisma.trade.findUniqueOrThrow({ where: { id: trade.id } })).toMatchObject({
      units: 12,
      fees: null,
      fxRate: null,
      notes: null,
    });
  });

  it("refuses an out-of-scope edit and a stale edit", async () => {
    const trade = await createTradeCommand(holdingId, buy(10, 100, "2025-01-02"));
    const other = await newHolding(portfolioId, "VGS.AX");
    await expect(updateTradeCommand(trade.id, { units: 1 }, { holdingId: other.id })).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
    await tick();
    await updateTradeCommand(trade.id, { units: 11 }, { baseUpdatedAt: trade.updatedAt });
    await expect(updateTradeCommand(trade.id, { units: 12 }, { baseUpdatedAt: trade.updatedAt })).rejects.toBeInstanceOf(
      StaleEditError,
    );
    expect((await db.prisma.trade.findUniqueOrThrow({ where: { id: trade.id } })).units).toBe(11);
  });

  it("permanently deletes a Trade with its files, in scope only", async () => {
    const trade = await createTradeCommand(holdingId, buy(10, 100, "2025-01-02"));
    const sibling = await createTradeCommand(holdingId, buy(1, 100, "2025-01-03"));
    const dir = await attachFile(trade.id);
    const siblingDir = await attachFile(sibling.id);

    await expect(permanentlyDeleteTradeCommand(trade.id, { holdingId: "other" })).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
    expect(await permanentlyDeleteTradeCommand(trade.id, { holdingId })).toEqual({ holdingId, portfolioId });
    expect(await db.prisma.trade.findUnique({ where: { id: trade.id } })).toBeNull();
    expect(await db.prisma.tradeDocument.count({ where: { tradeId: trade.id } })).toBe(0);
    expect(await exists(dir)).toBe(false);
    expect(await exists(siblingDir)).toBe(true);
    await expect(permanentlyDeleteTradeCommand(trade.id)).rejects.toBeInstanceOf(RecordNotFoundError);
  });

  // Cost basis is worked out from the Trades on each view (src/lib/wealth.ts).
  // Editing or deleting Trades through the commands must leave a Holding with
  // the same units and cost as the direct Prisma writes the actions made
  // before the commands existed.
  it("leaves units and cost basis as the old direct writes did, for FIFO and average cost", async () => {
    const lots = [
      buy(10, 100, "2025-01-02", { fees: 10 }),
      buy(10, 120, "2025-02-02", { fees: 10 }),
      tradeSchema.parse({ type: "SELL", date: "2025-03-02", units: 12, pricePerUnit: 130, fees: 10 }),
      buy(5, 90, "2025-04-02"),
      tradeSchema.parse({ type: "DIVIDEND", date: "2025-05-02", units: 1, pricePerUnit: 15 }),
    ];
    const viaCommands = holdingId;
    const viaPrisma = (await newHolding(portfolioId, "OLD.AX")).id;
    const commandTrades = [];
    const prismaTrades = [];
    for (const lot of lots) {
      commandTrades.push(await createTradeCommand(viaCommands, lot));
      prismaTrades.push(await db.prisma.trade.create({ data: { ...lot, holdingId: viaPrisma } }));
    }

    // Edit the second buy through the edit form's full submission.
    const submission = formData({
      type: "BUY",
      date: "2025-02-02",
      units: "8",
      pricePerUnit: "125",
      fees: "",
      currency: "AUD",
      fxRate: "",
      notes: "",
    });
    const patch = fullFormUpdate(tradeSchema, tradeSchema.parse(formToTradeInput(submission)), submission);
    await updateTradeCommand(commandTrades[1].id, patch, { holdingId: viaCommands });
    await db.prisma.trade.update({ where: { id: prismaTrades[1].id }, data: patch });
    // Delete the later buy.
    await permanentlyDeleteTradeCommand(commandTrades[3].id, { holdingId: viaCommands });
    await db.prisma.trade.delete({ where: { id: prismaTrades[3].id } });

    const tradesOf = (id: string) => db.prisma.trade.findMany({ where: { holdingId: id }, orderBy: { date: "asc" } });
    const fromCommands = await tradesOf(viaCommands);
    const fromPrisma = await tradesOf(viaPrisma);
    expect(fromCommands).toHaveLength(4);
    for (const method of ["FIFO", "AVERAGE"] as const) {
      const expected = holdingUnitsAndCost(fromPrisma, method);
      expect(holdingUnitsAndCost(fromCommands, method)).toEqual(expected);
      expect(expected.units).toBe(6);
    }
  });
});

describe("importTradesCommand", () => {
  it("creates Holdings as needed, skips duplicates and unreadable dates", async () => {
    const portfolio = await newPortfolio();
    const existing = await newHolding(portfolio.id, "VAS.AX", { name: "Kept name" });
    const row = { ticker: "VAS.AX", type: "BUY" as const, date: "2025-01-02", units: 10, pricePerUnit: 100, fees: 0, currency: "AUD" };
    const result = await importTradesCommand(portfolio.id, [
      row,
      { ...row },
      { ...row, ticker: "NDQ.AX", fees: 9.5 },
      { ...row, date: "not a date" },
    ]);
    expect(result).toEqual({ imported: 2, skipped: 2 });
    expect((await db.prisma.holding.findUniqueOrThrow({ where: { id: existing.id } })).name).toBe("Kept name");
    const ndq = await db.prisma.holding.findUniqueOrThrow({
      where: { portfolioId_ticker: { portfolioId: portfolio.id, ticker: "NDQ.AX" } },
      include: { trades: true },
    });
    expect(ndq.assetClass).toBe("SHARE");
    expect(ndq.trades).toMatchObject([{ units: 10, fees: 9.5 }]);
    expect((await db.prisma.trade.findFirstOrThrow({ where: { holdingId: existing.id } })).fees).toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith(`/wealth/portfolios/${portfolio.id}`);

    // A re-import of the same file adds nothing.
    expect(await importTradesCommand(portfolio.id, [row])).toEqual({ imported: 0, skipped: 1 });
  });

  it("refuses a Portfolio that's gone", async () => {
    await expect(importTradesCommand("missing", [])).rejects.toBeInstanceOf(RecordNotFoundError);
  });
});

describe("the WEALTH module gate", () => {
  it("refuses every command while Wealth is off", async () => {
    const portfolio = await newPortfolio();
    const holding = await newHolding(portfolio.id);
    const trade = await createTradeCommand(holding.id, buy(1, 1, "2025-01-02"));
    await setModuleEnabled("WEALTH", false);

    const calls = [
      () => newPortfolio("Off"),
      () => updatePortfolioCommand(portfolio.id, { name: "x" }),
      () => permanentlyDeletePortfolioCommand(portfolio.id),
      () => newHolding(portfolio.id, "NEW.AX"),
      () => updateHoldingCommand(holding.id, { name: "x" }),
      () => permanentlyDeleteHoldingCommand(holding.id),
      () => createTradeCommand(holding.id, buy(1, 1, "2025-01-02")),
      () => updateTradeCommand(trade.id, { units: 2 }),
      () => permanentlyDeleteTradeCommand(trade.id),
      () => importTradesCommand(portfolio.id, []),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toBeInstanceOf(ModuleDisabledError);
    }
    expect(await db.prisma.portfolio.count()).toBe(1);
    expect(await db.prisma.trade.findUniqueOrThrow({ where: { id: trade.id } })).toMatchObject({ units: 1 });
  });
});

describe("Wealth server actions", () => {
  function signInAs(role: "ADMIN" | "MEMBER" | "READONLY") {
    vi.mocked(auth).mockResolvedValue({ user: { id: actorId, role } } as never);
  }

  const tradeForm = () =>
    formData({ type: "BUY", date: "2025-01-02", units: "1", pricePerUnit: "1", currency: "AUD" });

  it("refuse a read-only member before writing anything", async () => {
    const portfolio = await newPortfolio("Keep");
    const holding = await newHolding(portfolio.id);
    const trade = await createTradeCommand(holding.id, buy(1, 1, "2025-01-02"));
    signInAs("READONLY");
    const calls = [
      () => createPortfolio(null, formData({ name: "New" })),
      () => updatePortfolio(portfolio.id, null, formData({ name: "Changed" })),
      () => deletePortfolio(portfolio.id),
      () => createHolding(portfolio.id, null, formData({ ticker: "NEW" })),
      () => updateHolding(portfolio.id, holding.id, null, formData({ ticker: "CHG" })),
      () => deleteHolding(portfolio.id, holding.id),
      () => createTrade(holding.id, null, tradeForm()),
      () => updateTrade(holding.id, trade.id, null, tradeForm()),
      () => deleteTrade(holding.id, trade.id),
      () => importTrades(portfolio.id, []),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toThrow("read-only");
    }
    expect(await db.prisma.portfolio.findUniqueOrThrow({ where: { id: portfolio.id } })).toMatchObject({ name: "Keep" });
    expect(await db.prisma.holding.count()).toBe(1);
    expect(await db.prisma.trade.count()).toBe(1);
  });

  it("turn a command's errors into the form's message", async () => {
    signInAs("MEMBER");
    const portfolio = await newPortfolio();
    const holding = await newHolding(portfolio.id, "VAS.AX");
    const trade = await createTradeCommand(holding.id, buy(1, 1, "2025-01-02"));
    const other = await newHolding(portfolio.id, "VGS.AX");

    expect(await updatePortfolio("missing", null, formData({ name: "x" }))).toEqual({ error: "Portfolio not found." });
    expect(await deletePortfolio("missing")).toEqual({ error: "Portfolio not found." });
    expect(await createHolding("missing", null, formData({ ticker: "X" }))).toEqual({ error: "Portfolio not found." });
    expect(await createHolding(portfolio.id, null, formData({ ticker: "vas.ax" }))).toEqual({
      error: "VAS.AX is already in this portfolio.",
    });
    expect(await updateHolding(portfolio.id, other.id, null, formData({ ticker: "VAS.AX" }))).toEqual({
      error: "VAS.AX is already in this portfolio.",
    });
    expect(await updateHolding("other-portfolio", holding.id, null, formData({ ticker: "VAS.AX" }))).toEqual({
      error: "Holding not found.",
    });
    expect(await deleteHolding("other-portfolio", holding.id)).toEqual({ error: "Holding not found." });
    expect(await createTrade("missing", null, tradeForm())).toEqual({ error: "Holding not found." });
    expect(await updateTrade(other.id, trade.id, null, tradeForm())).toEqual({ error: "Trade not found." });
    expect(await deleteTrade(other.id, trade.id)).toEqual({ error: "Trade not found." });
    expect(await importTrades("missing", [{ ticker: "X", type: "BUY", date: "2025-01-02", units: 1, pricePerUnit: 1, fees: 0, currency: "AUD" }])).toEqual({
      error: "Portfolio not found.",
    });
    expect(await db.prisma.trade.count()).toBe(1);
    expect(await db.prisma.holding.count()).toBe(2);
  });

  it("write through the commands and redirect on success", async () => {
    signInAs("MEMBER");
    await expect(createPortfolio(null, formData({ name: "Via action" }))).rejects.toThrow(/^REDIRECT \/wealth\/portfolios\//);
    const portfolio = await db.prisma.portfolio.findFirstOrThrow({ where: { name: "Via action" } });
    expect(portfolio.createdById).toBe(actorId);

    await expect(createHolding(portfolio.id, null, formData({ ticker: "iVV" }))).rejects.toThrow(
      /^REDIRECT \/wealth\/portfolios\/.+\/holdings\//,
    );
    const holding = await db.prisma.holding.findFirstOrThrow({ where: { portfolioId: portfolio.id } });
    expect(holding.ticker).toBe("IVV");

    await expect(createTrade(holding.id, null, tradeForm())).rejects.toThrow(
      `REDIRECT /wealth/portfolios/${portfolio.id}/holdings/${holding.id}`,
    );
    const trade = await db.prisma.trade.findFirstOrThrow({ where: { holdingId: holding.id } });
    expect(await deleteTrade(holding.id, trade.id)).toEqual({ success: "Trade deleted." });
    expect(
      await importTrades(portfolio.id, [{ ticker: "IVV", type: "BUY", date: "2025-01-02", units: 3, pricePerUnit: 1, fees: 0, currency: "AUD" }]),
    ).toEqual({ success: "Imported 1 trade." });
    await expect(deletePortfolio(portfolio.id)).rejects.toThrow("REDIRECT /wealth");
    expect(await db.prisma.portfolio.count()).toBe(0);
  });
});

// The offline sync handler goes through the same commands.
describe("sync entities for Wealth", () => {
  it("creates, refuses stale and orphaned writes, and deletes through the commands", async () => {
    const { ENTITY_SYNC_CONFIGS } = await import("@/app/api/sync/entityHandlers");
    const { id: portfolioId } = await ENTITY_SYNC_CONFIGS.portfolio.create!(
      portfolioSchema.parse({ name: "Synced" }),
      { userId: actorId },
    );
    const loaded = await db.prisma.portfolio.findUniqueOrThrow({ where: { id: portfolioId } });
    expect(loaded.createdById).toBe(actorId);
    await tick();
    await ENTITY_SYNC_CONFIGS.portfolio.update!(portfolioId, { name: "Renamed" }, {
      userId: actorId,
      baseUpdatedAt: loaded.updatedAt.toISOString(),
    });
    await expect(
      ENTITY_SYNC_CONFIGS.portfolio.update!(portfolioId, { name: "Again" }, {
        userId: actorId,
        baseUpdatedAt: loaded.updatedAt.toISOString(),
      }),
    ).rejects.toThrow("changed elsewhere");

    const { id: holdingId } = await ENTITY_SYNC_CONFIGS.holding.create!(holdingSchema.parse({ ticker: "VAS.AX" }), {
      userId: actorId,
      parentId: portfolioId,
    });
    await expect(
      ENTITY_SYNC_CONFIGS.holding.create!(holdingSchema.parse({ ticker: "VAS.AX" }), { userId: actorId, parentId: portfolioId }),
    ).rejects.toThrow("already in this portfolio");
    await expect(
      ENTITY_SYNC_CONFIGS.holding.update!(holdingId, { name: "x" }, { userId: actorId, parentId: "other" }),
    ).rejects.toThrow("Holding not found");
    await ENTITY_SYNC_CONFIGS.holding.update!(holdingId, { name: "Aussie" }, { userId: actorId });

    const { id: tradeId } = await ENTITY_SYNC_CONFIGS.trade.create!(buy(2, 50, "2025-06-01"), {
      userId: actorId,
      parentId: holdingId,
    });
    await expect(
      ENTITY_SYNC_CONFIGS.trade.update!(tradeId, { units: 3 }, { userId: actorId, parentId: "other" }),
    ).rejects.toThrow("Trade not found");
    await ENTITY_SYNC_CONFIGS.trade.update!(tradeId, { units: 3 }, { userId: actorId, parentId: holdingId });
    expect((await db.prisma.trade.findUniqueOrThrow({ where: { id: tradeId } })).units).toBe(3);
    const dir = await attachFile(tradeId);

    await ENTITY_SYNC_CONFIGS.portfolio.remove!(portfolioId, { userId: actorId });
    expect(await db.prisma.portfolio.count()).toBe(0);
    expect(await exists(dir)).toBe(false);
    // A queued child op replayed after its parent was deleted is refused.
    await expect(
      ENTITY_SYNC_CONFIGS.trade.create!(buy(1, 1, "2025-06-02"), { userId: actorId, parentId: holdingId }),
    ).rejects.toThrow("Holding not found");
    await expect(
      ENTITY_SYNC_CONFIGS.holding.create!(holdingSchema.parse({ ticker: "NEW" }), { userId: actorId, parentId: portfolioId }),
    ).rejects.toThrow("Portfolio not found");
  });
});
