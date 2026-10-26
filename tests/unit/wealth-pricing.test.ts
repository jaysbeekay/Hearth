// #404 — price routing (CoinGecko for crypto, Yahoo for the rest), what
// happens to prices cached from the wrong feed, unpriced Holdings, and a net
// worth whose listed parts add up to its total. No network: Yahoo is
// stubbed and fetch only answers CoinGecko URLs the test sets up.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser, setModuleEnabled } from "../helpers/testDb";

const { quote } = vi.hoisted(() => ({
  quote: vi.fn<(symbol: string) => Promise<{ regularMarketPrice: number; currency: string } | undefined>>(),
}));

vi.mock("yahoo-finance2", () => ({
  default: class {
    quote = quote;
    historical = vi.fn(async () => []);
  },
}));

import { isCryptoHolding, priceSourceFor } from "@/lib/priceSource";
import { refreshPricesForTickers, getPriceMap } from "@/lib/prices";
import { getNetWorth, netWorthComponents, valueHolding } from "@/lib/wealth";
import type { ModuleKey } from "@/lib/modules/registry";

const db = setupTestDb();

type CoinGeckoAnswer = Record<string, { aud: number; aud_24h_change?: number }>;

// Answers CoinGecko /simple/price by ids= or symbols=, from the given maps.
function stubCoinGecko(byId: CoinGeckoAnswer, bySymbol: CoinGeckoAnswer = {}) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.hostname !== "api.coingecko.com") throw new Error(`unexpected fetch ${url.href}`);
    const ids = url.searchParams.get("ids");
    const symbols = url.searchParams.get("symbols");
    const source = new Map(Object.entries(ids != null ? byId : bySymbol));
    const keys = (ids ?? symbols ?? "").split(",");
    const body = Object.fromEntries(keys.flatMap((k) => (source.has(k) ? [[k, source.get(k)]] : [])));
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const BTC_CRYPTO = { ticker: "BTC", assetClass: "CRYPTO", exchange: null };
const BTC_ETF = { ticker: "BTC", assetClass: "ETF", exchange: "NYSE" };

beforeEach(() => {
  quote.mockReset();
  quote.mockImplementation(async (symbol) => (symbol === "BTC" ? { regularMarketPrice: 35.89, currency: "USD" } : undefined));
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network access in a unit test"))));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isCryptoHolding / priceSourceFor", () => {
  it("routes a CRYPTO Holding with a blank exchange to CoinGecko", () => {
    expect(isCryptoHolding(BTC_CRYPTO)).toBe(true);
    expect(priceSourceFor({ assetClass: "CRYPTO", exchange: "" })).toBe("coingecko");
  });

  it("routes an equity BTC on an exchange to Yahoo", () => {
    expect(isCryptoHolding(BTC_ETF)).toBe(false);
    expect(priceSourceFor(BTC_ETF)).toBe("yahoo");
    expect(priceSourceFor({ assetClass: "SHARE", exchange: null })).toBe("yahoo");
  });

  it("falls back to the exchange, for Holdings marked crypto that way", () => {
    expect(priceSourceFor({ assetClass: "SHARE", exchange: "CRYPTO" })).toBe("coingecko");
  });

  it("ignores case and surrounding spaces", () => {
    expect(isCryptoHolding({ assetClass: "crypto", exchange: null })).toBe(true);
    expect(isCryptoHolding({ assetClass: " Crypto ", exchange: null })).toBe(true);
    expect(isCryptoHolding({ assetClass: "SHARE", exchange: "crypto" })).toBe(true);
    expect(isCryptoHolding({ assetClass: "Etf", exchange: "Nyse" })).toBe(false);
  });
});

describe("refreshPricesForTickers routing", () => {
  it("prices a blank-exchange CRYPTO BTC from CoinGecko, never Yahoo", async () => {
    // "btc" isn't a CoinGecko coin ID, so it falls back to the symbol.
    const fetchMock = stubCoinGecko({}, { btc: { aud: 150_000, aud_24h_change: 1.5 } });
    await refreshPricesForTickers([BTC_CRYPTO]);

    expect(quote).not.toHaveBeenCalled();
    const urls = fetchMock.mock.calls.map(([u]) => new URL(String(u)));
    expect(urls.map((u) => u.searchParams.get("ids") ?? `symbols=${u.searchParams.get("symbols")}`)).toEqual(["btc", "symbols=btc"]);
    expect(await getPriceMap([BTC_CRYPTO])).toEqual(new Map([["BTC", { price: 150_000, currency: "AUD", changePct: 1.5 }]]));
  });

  it("prices a CoinGecko coin ID directly", async () => {
    const fetchMock = stubCoinGecko({ bitcoin: { aud: 151_000 } });
    const holding = { ticker: "BITCOIN", assetClass: "Crypto", exchange: null };
    await refreshPricesForTickers([holding]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await getPriceMap([holding])).get("BITCOIN")?.price).toBe(151_000);
  });

  it("prices an equity BTC on an exchange from Yahoo", async () => {
    const fetchMock = stubCoinGecko({});
    await refreshPricesForTickers([BTC_ETF]);
    expect(quote).toHaveBeenCalledWith("BTC", {}, { validateResult: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await getPriceMap([BTC_ETF])).get("BTC")).toEqual({ price: 35.89, currency: "USD", changePct: null });
  });
});

describe("prices cached from the wrong feed before #404", () => {
  const seedYahooBtc = () =>
    db.prisma.priceCache.create({
      data: { ticker: "BTC", price: 35.89, currency: "USD", changePct: null, source: "yahoo", cachedAt: new Date() },
    });

  it("ignores a fresh Yahoo price for a crypto Holding", async () => {
    await seedYahooBtc();
    expect(await getPriceMap([BTC_CRYPTO])).toEqual(new Map());
    // The same row still counts for an equity BTC.
    expect((await getPriceMap([BTC_ETF])).get("BTC")?.price).toBe(35.89);
  });

  it("replaces it from CoinGecko on the next refresh, however fresh it is", async () => {
    await seedYahooBtc();
    stubCoinGecko({}, { btc: { aud: 150_000 } });
    await refreshPricesForTickers([BTC_CRYPTO]);
    const row = await db.prisma.priceCache.findUniqueOrThrow({ where: { ticker: "BTC" } });
    expect(row).toMatchObject({ price: 150_000, currency: "AUD", source: "coingecko" });
  });

  it("leaves the Holding unpriced when CoinGecko has nothing", async () => {
    await seedYahooBtc();
    stubCoinGecko({});
    await refreshPricesForTickers([BTC_CRYPTO]);
    expect(quote).not.toHaveBeenCalled();
    expect(await getPriceMap([BTC_CRYPTO])).toEqual(new Map());
  });
});

describe("valueHolding", () => {
  const base = { units: 2, cost: 100_000, priceCurrency: "AUD", portfolioCurrency: "AUD", rateMap: new Map<string, number>() };

  it("leaves a Holding with no price unpriced: no value, no gain/loss", () => {
    for (const price of [null, undefined, 0, -1, Number.NaN]) {
      expect(valueHolding({ ...base, price })).toEqual({
        currentPrice: null,
        currentValue: null,
        portfolioValue: null,
        gainLoss: null,
        gainLossPct: null,
        unpriced: true,
      });
    }
  });

  it("doesn't count a sold-out Holding as unpriced", () => {
    expect(valueHolding({ ...base, units: 0, price: null }).unpriced).toBe(false);
  });

  it("values a priced Holding", () => {
    expect(valueHolding({ ...base, price: 60_000 })).toMatchObject({
      currentValue: 120_000,
      portfolioValue: 120_000,
      gainLoss: 20_000,
      gainLossPct: 20,
      unpriced: false,
    });
  });

  it("converts to the portfolio's currency before comparing with cost", () => {
    const valued = valueHolding({ ...base, price: 100, priceCurrency: "USD", cost: 100, rateMap: new Map([["USD_AUD", 1.5]]) });
    expect(valued).toMatchObject({ currentValue: 200, portfolioValue: 300, gainLoss: 200, gainLossPct: 200 });
  });

  it("leaves gain/loss blank, and the Holding uncounted, without an FX rate", () => {
    const valued = valueHolding({ ...base, price: 100, priceCurrency: "USD" });
    expect(valued).toMatchObject({ currentPrice: 100, currentValue: 200, portfolioValue: null, gainLoss: null, unpriced: true });
  });
});

describe("netWorthComponents", () => {
  const values = { investments: 7_601.69, property: 0, items: 4_599 };

  it("lists Items and Property when their modules are on, and sums to the total", () => {
    const { components, total } = netWorthComponents(values, new Set<ModuleKey>(["WEALTH", "HOME", "INVENTORY"]));
    expect(components.map((c) => c.key)).toEqual(["INVESTMENTS", "PROPERTY", "ITEMS"]);
    expect(total).toBeCloseTo(12_200.69, 2);
    expect(components.reduce((s, c) => s + c.value, 0)).toBe(total);
  });

  it("leaves out the parts whose modules are off", () => {
    const { components, total } = netWorthComponents(values, new Set<ModuleKey>(["WEALTH"]));
    expect(components.map((c) => c.key)).toEqual(["INVESTMENTS"]);
    expect(total).toBe(7_601.69);
  });
});

describe("getNetWorth", () => {
  it("lists every part of the total, Items included, and leaves an unpriced crypto Holding out", async () => {
    const user = await createTestUser();
    await setModuleEnabled("INVENTORY", true);
    await setModuleEnabled("HOME", true);
    const portfolio = await db.prisma.portfolio.create({ data: { name: "Shares", createdById: user.id } });
    const etf = await db.prisma.holding.create({ data: { portfolioId: portfolio.id, ticker: "VAS.AX", assetClass: "ETF", exchange: "ASX" } });
    const btc = await db.prisma.holding.create({ data: { portfolioId: portfolio.id, ticker: "BTC", assetClass: "CRYPTO" } });
    await db.prisma.trade.createMany({
      data: [
        { holdingId: etf.id, type: "BUY", date: new Date("2025-01-02"), units: 10, pricePerUnit: 90, currency: "AUD" },
        { holdingId: btc.id, type: "BUY", date: new Date("2025-01-02"), units: 0.1, pricePerUnit: 100_000, currency: "AUD" },
      ],
    });
    const now = new Date();
    await db.prisma.priceCache.createMany({
      data: [
        { ticker: "VAS.AX", price: 100, currency: "AUD", source: "yahoo", cachedAt: now },
        // Left over from before #404: BTC the ETF, for a crypto Holding.
        { ticker: "BTC", price: 35.89, currency: "USD", source: "yahoo", cachedAt: now },
      ],
    });
    await db.prisma.inventoryItem.create({ data: { label: "Camera", purchasePrice: 4_599, currency: "AUD", createdById: user.id } });

    const data = await getNetWorth(new Set<ModuleKey>(["WEALTH", "HOME", "INVENTORY"]));

    expect(data.components).toEqual([
      { key: "INVESTMENTS", label: "Shares, ETFs and crypto", value: 1_000 },
      { key: "PROPERTY", label: "Property", value: 0 },
      { key: "ITEMS", label: "Items", value: 4_599 },
    ]);
    expect(data.totalNetWorth).toBe(5_599);
    expect(data.components.reduce((s, c) => s + c.value, 0)).toBe(data.totalNetWorth);
    expect(data.unpricedCount).toBe(1);
    const btcValue = data.portfolios[0].holdings.find((h) => h.ticker === "BTC");
    expect(btcValue).toMatchObject({ currentPrice: null, currentValue: null, gainLoss: null, gainLossPct: null, changePct: null });
  });
});
