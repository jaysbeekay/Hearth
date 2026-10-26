// #404 — price routing (CoinGecko for crypto, Yahoo for the rest), which
// CoinGecko coin a ticker means, prices cached from the wrong feed or not
// found, Trade currencies, unpriced Holdings, and a net worth whose listed
// parts add up to its total. No network: Yahoo is stubbed and fetch only
// answers CoinGecko URLs the test sets up.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser, setModuleEnabled } from "../helpers/testDb";

const { quote, quotes } = vi.hoisted(() => {
  const quotes = new Map<string, { regularMarketPrice: number; currency: string }>();
  return { quotes, quote: vi.fn(async (symbol: string) => quotes.get(symbol)) };
});

vi.mock("yahoo-finance2", () => ({
  default: class {
    quote = quote;
    historical = vi.fn(async () => []);
  },
}));

import { inferImportedAssetClass, isCryptoHolding, priceCacheKey, priceSourceFor } from "@/lib/priceSource";
import {
  clearCryptoResolution,
  clearFailedLookups,
  fetchCryptoPrices,
  getPriceMap,
  getQuoteCurrency,
  pickCoinGeckoHit,
  refreshAllPortfolioPrices,
  refreshPricesForTickers,
} from "@/lib/prices";
import {
  costUsesTodaysRate,
  getNetWorth,
  holdingUnitsAndCostIn,
  netWorthComponents,
  netWorthExclusionNote,
  unpricedHoldingsNote,
  valueHolding,
} from "@/lib/wealth";
import type { ModuleKey } from "@/lib/modules/registry";

const db = setupTestDb();

type CoinGeckoAnswer = Record<string, { aud: number; aud_24h_change?: number; aud_market_cap?: number }>;

// Answers CoinGecko /simple/price by ids= or symbols= from the given maps,
// or with `status` for every request (e.g. 429).
function stubCoinGecko(byId: CoinGeckoAnswer, bySymbol: CoinGeckoAnswer = {}, status = 200) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.hostname !== "api.coingecko.com") throw new Error(`unexpected fetch ${url.href}`);
    if (status !== 200) return new Response("{}", { status });
    expect(url.searchParams.get("include_market_cap")).toBe("true");
    const ids = url.searchParams.get("ids");
    const source = new Map(Object.entries(ids != null ? byId : bySymbol));
    const keys = (ids ?? url.searchParams.get("symbols") ?? "").split(",");
    const body = Object.fromEntries(keys.flatMap((k) => (source.has(k) ? [[k, source.get(k)]] : [])));
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestedLookups(fetchMock: ReturnType<typeof stubCoinGecko>): string[] {
  return fetchMock.mock.calls
    .map(([u]) => new URL(String(u)))
    .map((u) => (u.searchParams.has("ids") ? `ids=${u.searchParams.get("ids")}` : `symbols=${u.searchParams.get("symbols")}`))
    .sort();
}

const BTC_CRYPTO = { ticker: "BTC", assetClass: "CRYPTO", exchange: null };
const BTC_ETF = { ticker: "BTC", assetClass: "ETF", exchange: "NYSE" };
// Live CoinGecko shapes from the #404 review: ids=dot is an obscure "Dot".
const POLKADOT = { aud: 1.45, aud_market_cap: 2_300_000_000 };
const TINY_DOT = { aud: 0.0119, aud_market_cap: 12_000 };

beforeEach(() => {
  quotes.clear();
  quotes.set("BTC", { regularMarketPrice: 35.89, currency: "USD" });
  quote.mockClear();
  clearCryptoResolution();
  clearFailedLookups();
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network access in a unit test"))));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("isCryptoHolding / priceSourceFor / priceCacheKey", () => {
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

  it("keys crypto and an equity with the same ticker apart", () => {
    expect(priceCacheKey(BTC_CRYPTO)).toBe("cg:btc");
    expect(priceCacheKey({ ...BTC_CRYPTO, ticker: " Btc " })).toBe("cg:btc");
    expect(priceCacheKey(BTC_ETF)).toBe("BTC");
  });
});

describe("pickCoinGeckoHit", () => {
  it("prefers the symbol's coin when it's bigger than the coin-ID hit (DOT, LINK)", () => {
    expect(pickCoinGeckoHit(TINY_DOT, POLKADOT)).toEqual({ row: POLKADOT, lookup: "symbols" });
    const chainlink = { aud: 16.12, aud_market_cap: 10_000_000_000 };
    expect(pickCoinGeckoHit({ aud: 26.7, aud_market_cap: 1_000_000 }, chainlink)?.row).toBe(chainlink);
  });

  it("keeps the coin ID when it's the bigger coin, or on a tie", () => {
    const bitcoin = { aud: 150_000, aud_market_cap: 3e12 };
    expect(pickCoinGeckoHit(bitcoin, { aud: 0.5, aud_market_cap: 10 })?.lookup).toBe("ids");
    expect(pickCoinGeckoHit({ aud: 1 }, { aud: 2 })?.lookup).toBe("ids");
  });

  it("takes whichever is usable, or nothing", () => {
    expect(pickCoinGeckoHit(undefined, POLKADOT)?.lookup).toBe("symbols");
    expect(pickCoinGeckoHit({ aud: 0 }, undefined)).toBeNull();
    expect(pickCoinGeckoHit(undefined, undefined)).toBeNull();
  });
});

describe("fetchCryptoPrices", () => {
  it("prices DOT as Polkadot when ids=dot is a tiny-cap coin", async () => {
    const fetchMock = stubCoinGecko({ dot: TINY_DOT }, { dot: POLKADOT });
    const [result] = await fetchCryptoPrices(["DOT"]);
    expect(result).toMatchObject({ ticker: "DOT", price: 1.45, currency: "AUD", source: "coingecko" });
    expect(requestedLookups(fetchMock)).toEqual(["ids=dot", "symbols=dot"]);
  });

  it("remembers how a ticker resolved and asks only that way afterwards", async () => {
    const fetchMock = stubCoinGecko({ dot: TINY_DOT, bitcoin: { aud: 150_000, aud_market_cap: 3e12 } }, { dot: POLKADOT });
    await fetchCryptoPrices(["DOT", "bitcoin"]);
    fetchMock.mockClear();
    const results = await fetchCryptoPrices(["DOT", "bitcoin"]);
    expect(results.map((r) => r.price)).toEqual([1.45, 150_000]);
    expect(requestedLookups(fetchMock)).toEqual(["ids=bitcoin", "symbols=dot"]);
  });
});

describe("refreshPricesForTickers routing", () => {
  it("prices a blank-exchange CRYPTO BTC from CoinGecko, never Yahoo", async () => {
    // "btc" isn't a CoinGecko coin ID, so only the symbol lookup finds it.
    const fetchMock = stubCoinGecko({}, { btc: { aud: 150_000, aud_24h_change: 1.5, aud_market_cap: 3e12 } });
    await refreshPricesForTickers([BTC_CRYPTO]);

    expect(quote).not.toHaveBeenCalled();
    expect(requestedLookups(fetchMock)).toEqual(["ids=btc", "symbols=btc"]);
    expect(await getPriceMap([BTC_CRYPTO])).toEqual(new Map([["cg:btc", { price: 150_000, currency: "AUD", changePct: 1.5 }]]));
  });

  it("prices a CoinGecko coin ID directly", async () => {
    stubCoinGecko({ bitcoin: { aud: 151_000, aud_market_cap: 3e12 } });
    const holding = { ticker: "BITCOIN", assetClass: "Crypto", exchange: null };
    await refreshPricesForTickers([holding]);
    expect((await getPriceMap([holding])).get("cg:bitcoin")?.price).toBe(151_000);
  });

  it("prices an equity BTC on an exchange from Yahoo", async () => {
    const fetchMock = stubCoinGecko({});
    await refreshPricesForTickers([BTC_ETF]);
    expect(quote).toHaveBeenCalledWith("BTC", {}, { validateResult: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await getPriceMap([BTC_ETF])).get("BTC")).toEqual({ price: 35.89, currency: "USD", changePct: null });
  });

  it("prices the ETF and the coin separately when both are held", async () => {
    stubCoinGecko({}, { btc: { aud: 150_000, aud_market_cap: 3e12 } });
    await refreshPricesForTickers([BTC_ETF, BTC_CRYPTO]);
    const map = await getPriceMap([BTC_ETF, BTC_CRYPTO]);
    expect(map.get("BTC")?.price).toBe(35.89);
    expect(map.get("cg:btc")?.price).toBe(150_000);
  });
});

describe("misses and rate limits are cached for the TTL", () => {
  it("records a rate-limited lookup as no price and doesn't ask again within the TTL", async () => {
    const fetchMock = stubCoinGecko({}, {}, 429);
    await refreshPricesForTickers([BTC_CRYPTO]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await db.prisma.priceCache.findUniqueOrThrow({ where: { ticker: "cg:btc" } })).toMatchObject({ price: 0, source: "coingecko" });
    expect(await getPriceMap([BTC_CRYPTO])).toEqual(new Map());

    fetchMock.mockClear();
    await refreshPricesForTickers([BTC_CRYPTO]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the last good price through a failed lookup, and its fetch time", async () => {
    const fetchedAt = new Date(Date.now() - 10 * 60 * 1000);
    await db.prisma.priceCache.create({
      data: { ticker: "cg:btc", price: 149_000, currency: "AUD", source: "coingecko", cachedAt: fetchedAt },
    });
    const fetchMock = stubCoinGecko({}, {}, 429);
    await refreshPricesForTickers([BTC_CRYPTO]);
    const row = await db.prisma.priceCache.findUniqueOrThrow({ where: { ticker: "cg:btc" } });
    expect(row.price).toBe(149_000);
    expect(row.cachedAt).toEqual(fetchedAt);
    expect((await getPriceMap([BTC_CRYPTO])).get("cg:btc")?.price).toBe(149_000);

    // The failure is the retry clock: no new request within the TTL.
    fetchMock.mockClear();
    await refreshPricesForTickers([BTC_CRYPTO]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("drops a last good price fetched over a day ago when the lookup fails", async () => {
    await db.prisma.priceCache.create({
      data: { ticker: "cg:btc", price: 149_000, currency: "AUD", source: "coingecko", cachedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });
    stubCoinGecko({}, {}, 429);
    await refreshPricesForTickers([BTC_CRYPTO]);
    expect(await db.prisma.priceCache.findUniqueOrThrow({ where: { ticker: "cg:btc" } })).toMatchObject({ price: 0 });
    expect(await getPriceMap([BTC_CRYPTO])).toEqual(new Map());
  });

  it("stops keeping a price a day after it was fetched, however often lookups fail", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = new Date("2026-01-01T00:00:00Z");
    vi.setSystemTime(start);
    await db.prisma.priceCache.create({
      data: { ticker: "cg:btc", price: 149_000, currency: "AUD", source: "coingecko", cachedAt: start },
    });
    stubCoinGecko({}, {}, 429);
    // A failed lookup every 6 hours keeps the price, but not past a day.
    for (const hours of [6, 12, 18]) {
      vi.setSystemTime(new Date(start.getTime() + hours * 60 * 60 * 1000));
      await refreshPricesForTickers([BTC_CRYPTO]);
      expect((await getPriceMap([BTC_CRYPTO])).get("cg:btc")?.price).toBe(149_000);
    }
    vi.setSystemTime(new Date(start.getTime() + 25 * 60 * 60 * 1000));
    await refreshPricesForTickers([BTC_CRYPTO]);
    expect(await getPriceMap([BTC_CRYPTO])).toEqual(new Map());
  });

  it("caches a Yahoo miss too", async () => {
    const holding = { ticker: "NOPE.AX", assetClass: "SHARE", exchange: "ASX" };
    await refreshPricesForTickers([holding]);
    await refreshPricesForTickers([holding]);
    expect(quote).toHaveBeenCalledTimes(1);
    expect(await getPriceMap([holding])).toEqual(new Map());
  });
});

describe("getQuoteCurrency", () => {
  it("gives the currency of a priced Yahoo row only", async () => {
    await db.prisma.priceCache.createMany({
      data: [
        { ticker: "AAPL", price: 200, currency: "USD", source: "yahoo", cachedAt: new Date() },
        { ticker: "NOPE", price: 0, currency: "AUD", source: "yahoo", cachedAt: new Date() },
        { ticker: "cg:btc", price: 150_000, currency: "AUD", source: "coingecko", cachedAt: new Date() },
      ],
    });
    expect(await getQuoteCurrency("AAPL")).toBe("USD");
    expect(await getQuoteCurrency("NOPE")).toBeNull();
    expect(await getQuoteCurrency("cg:btc")).toBeNull();
    expect(await getQuoteCurrency("MISSING")).toBeNull();
  });
});

describe("prices cached from the wrong feed before #404", () => {
  it("deletes pre-#404 CoinGecko rows not under a cg: key on a full refresh", async () => {
    await db.prisma.priceCache.createMany({
      data: [
        { ticker: "BTC-AUD", price: 150_000, currency: "AUD", source: "coingecko", cachedAt: new Date() },
        { ticker: "cg:eth", price: 5_000, currency: "AUD", source: "coingecko", cachedAt: new Date() },
        { ticker: "VAS.AX", price: 100, currency: "AUD", source: "yahoo", cachedAt: new Date() },
      ],
    });
    await refreshAllPortfolioPrices();
    const left = await db.prisma.priceCache.findMany({ orderBy: { ticker: "asc" } });
    expect(left.map((r) => r.ticker)).toEqual(["VAS.AX", "cg:eth"]);
  });

  it("never uses a Yahoo row for a crypto Holding, and replaces nothing an equity needs", async () => {
    await db.prisma.priceCache.create({
      data: { ticker: "BTC", price: 35.89, currency: "USD", changePct: null, source: "yahoo", cachedAt: new Date() },
    });
    expect(await getPriceMap([BTC_CRYPTO])).toEqual(new Map());
    expect((await getPriceMap([BTC_ETF])).get("BTC")?.price).toBe(35.89);

    stubCoinGecko({}, { btc: { aud: 150_000, aud_market_cap: 3e12 } });
    await refreshPricesForTickers([BTC_CRYPTO]);
    expect((await getPriceMap([BTC_CRYPTO])).get("cg:btc")?.price).toBe(150_000);
  });

  it("re-fetches a row under the crypto key that came from the wrong feed", async () => {
    await db.prisma.priceCache.create({
      data: { ticker: "cg:btc", price: 35.89, currency: "USD", source: "yahoo", cachedAt: new Date() },
    });
    stubCoinGecko({}, { btc: { aud: 150_000 } });
    await refreshPricesForTickers([BTC_CRYPTO]);
    expect(await db.prisma.priceCache.findUniqueOrThrow({ where: { ticker: "cg:btc" } })).toMatchObject({
      price: 150_000,
      currency: "AUD",
      source: "coingecko",
    });
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
        unpricedReason: "NO_PRICE",
      });
    }
  });

  it("doesn't count a sold-out Holding as unpriced", () => {
    expect(valueHolding({ ...base, units: 0, price: null }).unpricedReason).toBeNull();
  });

  it("values a priced Holding", () => {
    expect(valueHolding({ ...base, price: 60_000 })).toMatchObject({
      currentValue: 120_000,
      portfolioValue: 120_000,
      gainLoss: 20_000,
      gainLossPct: 20,
      unpricedReason: null,
    });
  });

  it("converts to the portfolio's currency before comparing with cost", () => {
    const valued = valueHolding({ ...base, price: 100, priceCurrency: "USD", cost: 100, rateMap: new Map([["USD_AUD", 1.5]]) });
    expect(valued).toMatchObject({ currentValue: 200, portfolioValue: 300, gainLoss: 200, gainLossPct: 200 });
  });

  it("leaves it uncounted, as no exchange rate, when the price or the cost can't be converted", () => {
    expect(valueHolding({ ...base, price: 100, priceCurrency: "USD" })).toMatchObject({
      currentPrice: 100,
      currentValue: 200,
      portfolioValue: null,
      gainLoss: null,
      unpricedReason: "NO_FX",
    });
    expect(valueHolding({ ...base, price: 100, cost: null })).toMatchObject({ gainLoss: null, unpricedReason: "NO_FX" });
  });
});

describe("holdingUnitsAndCostIn", () => {
  const trade = (currency: string, units: number, pricePerUnit: number, extra: { fees?: number; fxRate?: number } = {}) => ({
    type: "BUY",
    units,
    pricePerUnit,
    fees: extra.fees ?? null,
    currency,
    fxRate: extra.fxRate ?? null,
  });
  const rates = new Map([["USD_AUD", 1.5], ["AUD_USD", 0.66]]);

  it("converts USD Trades into an AUD portfolio at the cached rate", () => {
    expect(holdingUnitsAndCostIn([trade("USD", 10, 100, { fees: 10 })], "FIFO", "AUD", rates)).toEqual({ units: 10, cost: 1_515 });
  });

  it("uses the Trade's own FX rate to AUD when one was entered", () => {
    expect(holdingUnitsAndCostIn([trade("USD", 10, 100, { fxRate: 1.6 })], "FIFO", "AUD", rates).cost).toBeCloseTo(1_600);
  });

  it("adds mixed-currency Trades in one Holding like with like", () => {
    const { cost } = holdingUnitsAndCostIn([trade("AUD", 10, 150), trade("USD", 10, 100)], "AVERAGE", "AUD", rates);
    expect(cost).toBeCloseTo(3_000);
  });

  it("gives no cost, rather than a guess, when a Trade's rate is missing", () => {
    expect(holdingUnitsAndCostIn([trade("GBP", 10, 100)], "FIFO", "AUD", rates)).toEqual({ units: 10, cost: null });
  });

  // A SELL, SPLIT or DIVIDEND's price doesn't go into cost, so its currency
  // needing a rate that isn't cached mustn't blank out the whole Holding.
  // 1,000 AUD over 20 units after the split, then 5 sold: FIFO sells from
  // the 1,000 AUD lot first, average cost sells a quarter of the pool.
  for (const [method, cost] of [["FIFO", 500], ["AVERAGE", 750]] as const) {
    it(`converts only BUYs (${method})`, () => {
      const other = (type: string, units: number) => ({ ...trade("GBP", units, 999), type });
      const trades = [trade("AUD", 10, 100), other("SPLIT", 10), other("DIVIDEND", 1), other("SELL", 5)];
      expect(holdingUnitsAndCostIn(trades, method, "AUD", rates)).toEqual({ units: 15, cost });
    });
  }

  it("says when cost uses today's rate for a BUY", () => {
    expect(costUsesTodaysRate([trade("USD", 1, 1)], "AUD")).toBe(true);
    expect(costUsesTodaysRate([trade("USD", 1, 1, { fxRate: 1.5 })], "AUD")).toBe(false);
    expect(costUsesTodaysRate([trade("AUD", 1, 1), { ...trade("USD", 1, 1), type: "SELL" }], "AUD")).toBe(false);
    // A Trade's own rate is to AUD, so it doesn't apply to a USD portfolio.
    expect(costUsesTodaysRate([trade("AUD", 1, 1, { fxRate: 0.66 })], "USD")).toBe(true);
  });
});

describe("netWorthComponents and the notes", () => {
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

  it("names everything the total leaves out", () => {
    expect(netWorthExclusionNote({ holdings: 0, portfolios: 0, properties: 0, items: 0 })).toBeNull();
    expect(netWorthExclusionNote({ holdings: 2, portfolios: 1, properties: 0, items: 1 })).toBe(
      "Not counted: 2 holdings with no price or exchange rate, 1 portfolio with no exchange rate, 1 item with no exchange rate.",
    );
    expect(unpricedHoldingsNote(1)).toBe("1 holding has no price or exchange rate and isn't counted.");
    expect(unpricedHoldingsNote(0)).toBeNull();
  });
});

describe("inferImportedAssetClass", () => {
  it("reads an Asset Class or Exchange column", () => {
    expect(inferImportedAssetClass({ assetClass: "Crypto" })).toBe("CRYPTO");
    expect(inferImportedAssetClass({ exchange: "crypto" })).toBe("CRYPTO");
    expect(inferImportedAssetClass({ assetClass: "ETF", exchange: "NYSE" })).toBe("SHARE");
  });

  it("never guesses crypto from the ticker: BTC is also a listed ETF", () => {
    expect(inferImportedAssetClass({})).toBe("SHARE");
    expect(inferImportedAssetClass({ assetClass: null, exchange: null })).toBe("SHARE");
  });
});

describe("getNetWorth", () => {
  let userId: string;
  const now = () => new Date();

  async function portfolio(name: string, currency = "AUD") {
    return db.prisma.portfolio.create({ data: { name, currency, createdById: userId } });
  }
  async function holding(
    portfolioId: string,
    ticker: string,
    assetClass: "ETF" | "SHARE" | "CRYPTO",
    trade: { units: number; price: number; currency?: string },
  ) {
    const h = await db.prisma.holding.create({ data: { portfolioId, ticker, assetClass } });
    await db.prisma.trade.create({
      data: { holdingId: h.id, type: "BUY", date: new Date("2025-01-02"), units: trade.units, pricePerUnit: trade.price, currency: trade.currency ?? "AUD" },
    });
    return h;
  }
  const price = (ticker: string, value: number, currency: string, source: "yahoo" | "coingecko") =>
    db.prisma.priceCache.create({ data: { ticker, price: value, currency, source, cachedAt: now() } });
  const rate = (pair: string, value: number) => db.prisma.fxRate.create({ data: { pair, rate: value, cachedAt: now() } });

  beforeEach(async () => {
    userId = (await createTestUser()).id;
  });

  it("lists every part of the total, Items included, and leaves an unpriced crypto Holding out", async () => {
    await setModuleEnabled("INVENTORY", true);
    await setModuleEnabled("HOME", true);
    const p = await portfolio("Shares");
    await holding(p.id, "VAS.AX", "ETF", { units: 10, price: 90 });
    await holding(p.id, "BTC", "CRYPTO", { units: 0.1, price: 100_000 });
    await price("VAS.AX", 100, "AUD", "yahoo");
    // Left over from before #404: BTC the ETF, for a crypto Holding.
    await price("BTC", 35.89, "USD", "yahoo");
    await db.prisma.inventoryItem.create({ data: { label: "Camera", purchasePrice: 4_599, currency: "AUD", createdById: userId } });

    const data = await getNetWorth(new Set<ModuleKey>(["WEALTH", "HOME", "INVENTORY"]));

    expect(data.components).toEqual([
      { key: "INVESTMENTS", label: "Shares, ETFs and crypto", value: 1_000 },
      { key: "PROPERTY", label: "Property", value: 0 },
      { key: "ITEMS", label: "Items", value: 4_599 },
    ]);
    expect(data.totalNetWorth).toBe(5_599);
    expect(data.components.reduce((s, c) => s + c.value, 0)).toBe(data.totalNetWorth);
    expect(data.excluded).toEqual({ holdings: 1, portfolios: 0, properties: 0, items: 0 });
    const btc = data.portfolios[0].holdings.find((h) => h.ticker === "BTC");
    expect(btc).toMatchObject({ currentPrice: null, currentValue: null, gainLoss: null, gainLossPct: null, changePct: null, unpricedReason: "NO_PRICE" });
    // The portfolio's gain/loss compares counted value with counted cost.
    expect(data.portfolios[0]).toMatchObject({ totalValue: 1_000, totalCost: 10_900, pricedCost: 900, unpricedCount: 1 });
  });

  it("values a BTC ETF and BTC the coin each at their own price", async () => {
    const a = await portfolio("ETFs");
    const b = await portfolio("Coins");
    await holding(a.id, "BTC", "ETF", { units: 100, price: 40 });
    await holding(b.id, "BTC", "CRYPTO", { units: 0.1, price: 100_000 });
    await price("BTC", 50, "AUD", "yahoo");
    await price("cg:btc", 150_000, "AUD", "coingecko");

    const data = await getNetWorth(new Set<ModuleKey>(["WEALTH"]));
    expect(data.portfolios.map((p) => p.totalValue)).toEqual([5_000, 15_000]);
    expect(data.totalNetWorth).toBe(20_000);
  });

  it("converts USD Trades and a USD price into an AUD portfolio", async () => {
    const p = await portfolio("US");
    await holding(p.id, "AAPL", "SHARE", { units: 10, price: 100, currency: "USD" });
    await price("AAPL", 200, "USD", "yahoo");
    await rate("USD_AUD", 1.5);

    const [aapl] = (await getNetWorth(new Set<ModuleKey>(["WEALTH"]))).portfolios[0].holdings;
    // Cost 10 x 100 USD = 1,500 AUD; value 10 x 200 USD = 3,000 AUD.
    expect(aapl).toMatchObject({ costBasis: 1_500, gainLoss: 1_500, gainLossPct: 100, netWorthValue: 3_000, costCurrency: "AUD" });
  });

  it("values a USD portfolio holding an AUD stock and crypto", async () => {
    const p = await portfolio("USD book", "USD");
    await holding(p.id, "VAS.AX", "ETF", { units: 10, price: 66, currency: "USD" });
    await holding(p.id, "BTC", "CRYPTO", { units: 0.1, price: 66_000, currency: "USD" });
    await price("VAS.AX", 100, "AUD", "yahoo");
    await price("cg:btc", 150_000, "AUD", "coingecko");
    await rate("AUD_USD", 0.66);
    await rate("USD_AUD", 1 / 0.66);

    const data = await getNetWorth(new Set<ModuleKey>(["WEALTH"]));
    const [portfolioValue] = data.portfolios;
    // 1,000 AUD + 15,000 AUD = 16,000 AUD = 10,560 USD.
    expect(portfolioValue.totalValue).toBeCloseTo(10_560);
    expect(portfolioValue.pricedCost).toBeCloseTo(660 + 6_600);
    expect(data.totalNetWorth).toBeCloseTo(16_000);
  });

  it("explains a Trade, portfolio or Item it can't convert instead of guessing", async () => {
    await setModuleEnabled("INVENTORY", true);
    const p = await portfolio("Mixed");
    await holding(p.id, "VOD.L", "SHARE", { units: 10, price: 1, currency: "GBP" });
    await price("VOD.L", 2, "AUD", "yahoo");
    const nzd = await portfolio("Kiwi", "NZD");
    await holding(nzd.id, "FPH.NZ", "SHARE", { units: 1, price: 30, currency: "NZD" });
    await price("FPH.NZ", 35, "NZD", "yahoo");
    await db.prisma.inventoryItem.create({ data: { label: "Watch", purchasePrice: 500, currency: "CHF", createdById: userId } });

    const data = await getNetWorth(new Set<ModuleKey>(["WEALTH", "INVENTORY"]));
    expect(data.portfolios[0].holdings[0]).toMatchObject({ costBasis: null, gainLoss: null, unpricedReason: "NO_FX" });
    expect(data.excluded).toEqual({ holdings: 1, portfolios: 1, properties: 0, items: 1 });
    expect(data.totalNetWorth).toBe(0);
  });
});
