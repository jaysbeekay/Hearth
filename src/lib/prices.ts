import { prisma } from "@/lib/prisma";
import { isCryptoHolding, priceCacheKey, priceSourceFor, type PricedHolding, type PriceRoutingFields } from "@/lib/priceSource";

const EQUITY_TTL_MS = 15 * 60 * 1000; // 15 minutes
const CRYPTO_TTL_MS = 5 * 60 * 1000;  // 5 minutes

// yahoo-finance2 v3 requires instantiating the default export rather than
// calling its methods directly (v2-style) — https://github.com/gadicc/yahoo-finance2/blob/dev/docs/UPGRADING.md
// Loaded once and shared: concurrent first calls would otherwise each start
// their own import of the module.
let yahooFinanceModule: Promise<typeof import("yahoo-finance2")> | undefined;
async function getYahooFinance() {
  yahooFinanceModule ??= import("yahoo-finance2");
  const YahooFinance = (await yahooFinanceModule).default;
  return new YahooFinance({ suppressNotices: ["yahooSurvey"] });
}

interface PriceResult {
  ticker: string;
  price: number;
  currency: string;
  changePct: number | null;
  source: string;
}

export async function fetchEquityPrices(symbols: string[]): Promise<PriceResult[]> {
  if (!symbols.length) return [];
  try {
    const yahooFinance = await getYahooFinance();
    const results: PriceResult[] = [];
    // Keep upstream pressure bounded while avoiding one network round-trip at a time.
    const queue = [...symbols];
    const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) {
        const symbol = queue.shift();
        if (!symbol) return;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const quote = (await yahooFinance.quote(symbol, {}, { validateResult: false })) as any;
          if (quote?.regularMarketPrice != null) results.push({ ticker: symbol, price: quote.regularMarketPrice as number, currency: ((quote.currency as string | undefined) ?? "USD").toUpperCase(), changePct: (quote.regularMarketChangePercent as number | undefined) ?? null, source: "yahoo" });
        } catch { /* individual symbol failure — skip */ }
      }
    });
    await Promise.all(workers);
    return results;
  } catch {
    return [];
  }
}

type CoinGeckoRow = { aud?: number; aud_24h_change?: number; aud_market_cap?: number };

// One CoinGecko /simple/price request, keyed by "ids" (CoinGecko coin IDs,
// e.g. bitcoin) or "symbols" (e.g. btc). Returns rows by lowercased key; an
// error, timeout or non-OK response (429 included) is an empty map.
async function fetchCoinGecko(param: "ids" | "symbols", keys: string[]): Promise<Map<string, CoinGeckoRow>> {
  if (!keys.length) return new Map();
  try {
    // Build the request from a fixed base: the user-entered tickers flow only
    // through searchParams, never through a URL string handed to fetch
    // (Codacy user-controlled-URL rule, #436).
    const url = new URL("https://api.coingecko.com/api/v3/simple/price");
    url.searchParams.set(param, keys.join(","));
    url.searchParams.set("vs_currencies", "aud");
    url.searchParams.set("include_24hr_change", "true");
    url.searchParams.set("include_market_cap", "true");
    const res = await fetch(url, { signal: AbortSignal.timeout(COINGECKO_TIMEOUT_MS) });
    if (!res.ok) return new Map();
    const data = (await res.json()) as Record<string, CoinGeckoRow> | null;
    return new Map(Object.entries(data ?? {}).map(([key, row]) => [key.toLowerCase(), row]));
  } catch {
    return new Map();
  }
}

const COINGECKO_TIMEOUT_MS = 10_000;
// How long a ticker's resolution (coin ID or symbol) is trusted before both
// lookups run again.
const RESOLUTION_TTL_MS = 24 * 60 * 60 * 1000;
type CryptoLookup = "ids" | "symbols";
// Lowercased ticker -> which lookup found the major coin. In-process only:
// after a restart the first refresh asks both again, which costs one extra
// request, not a wrong price.
const cryptoResolution = new Map<string, { lookup: CryptoLookup; at: number }>();

/** For tests: forget every ticker's resolved lookup. */
export function clearCryptoResolution(): void {
  cryptoResolution.clear();
}

function usable(row: CoinGeckoRow | undefined): row is CoinGeckoRow & { aud: number } {
  return row?.aud != null && Number.isFinite(row.aud) && row.aud > 0;
}

/**
 * Picks between a ticker's coin-ID hit and its symbol hit: the larger AUD
 * market cap wins, and a tie (or no caps) goes to the coin ID, which the
 * user typed on purpose. A coin ID can be an obscure token that happens to
 * share a major coin's symbol: `ids=dot` is "Dot" at about AUD 0.01, while
 * `symbols=dot` is Polkadot (#404 review).
 */
export function pickCoinGeckoHit(
  byId: CoinGeckoRow | undefined,
  bySymbol: CoinGeckoRow | undefined,
): { row: CoinGeckoRow & { aud: number }; lookup: CryptoLookup } | null {
  const id = usable(byId) ? byId : null;
  const symbol = usable(bySymbol) ? bySymbol : null;
  if (id && symbol) {
    return (symbol.aud_market_cap ?? 0) > (id.aud_market_cap ?? 0)
      ? { row: symbol, lookup: "symbols" }
      : { row: id, lookup: "ids" };
  }
  if (id) return { row: id, lookup: "ids" };
  if (symbol) return { row: symbol, lookup: "symbols" };
  return null;
}

/**
 * Prices crypto tickers in AUD from CoinGecko, in at most two requests run
 * side by side (coin IDs and symbols), each with a 10s timeout. A ticker not
 * resolved yet is looked up both ways and the bigger coin wins (see
 * pickCoinGeckoHit); once resolved it's only looked up the winning way. A
 * ticker neither lookup finds is left out, so it shows as unpriced rather
 * than borrowing another feed's price.
 */
export async function fetchCryptoPrices(tickers: string[]): Promise<PriceResult[]> {
  if (!tickers.length) return [];
  const now = Date.now();
  const keys = [...new Set(tickers.map((t) => t.trim().toLowerCase()))];
  const resolvedLookup = (key: string) => {
    const entry = cryptoResolution.get(key);
    return entry && now - entry.at < RESOLUTION_TTL_MS ? entry.lookup : null;
  };
  const [byId, bySymbol] = await Promise.all([
    fetchCoinGecko("ids", keys.filter((k) => resolvedLookup(k) !== "symbols")),
    fetchCoinGecko("symbols", keys.filter((k) => resolvedLookup(k) !== "ids")),
  ]);

  const picked = new Map<string, CoinGeckoRow & { aud: number }>();
  for (const key of keys) {
    const hit = pickCoinGeckoHit(byId.get(key), bySymbol.get(key));
    if (!hit) {
      // Maybe the coin was renamed or delisted: ask both ways next time.
      cryptoResolution.delete(key);
      continue;
    }
    picked.set(key, hit.row);
    if (!resolvedLookup(key)) cryptoResolution.set(key, { lookup: hit.lookup, at: now });
  }

  return tickers.flatMap((ticker) => {
    const row = picked.get(ticker.trim().toLowerCase());
    if (!row) return [];
    return [{ ticker, price: row.aud, currency: "AUD", changePct: row.aud_24h_change ?? null, source: "coingecko" }];
  });
}

// A failed lookup keeps the last good price until it is this old, counted
// from cachedAt (when it was actually fetched); after that it's dropped.
const LAST_GOOD_PRICE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Cache key -> when a lookup last failed while the row kept its last good
// price. This is the retry clock for those rows, kept apart from cachedAt
// so cachedAt stays the time the price was fetched and the one-day limit
// holds (#404 review). In-process only: after a restart such a ticker is
// asked about once more, which costs one request, not a wrong price.
const failedLookupAt = new Map<string, number>();

/** For tests: forget when lookups last failed. */
export function clearFailedLookups(): void {
  failedLookupAt.clear();
}

/**
 * Refreshes the price cache for these Holdings: crypto from CoinGecko,
 * everything else from Yahoo (see isCryptoHolding), each under its own
 * priceCacheKey. A row from the other feed, or older than its TTL (15 min
 * for equities, 5 min for crypto), is stale. A lookup that fails or finds
 * nothing is cached too, for the same TTL, so a no-match or rate-limited
 * ticker isn't re-requested on every page view: the last good price is kept
 * until it's a day old (by when it was fetched), otherwise the row records
 * price 0, which getPriceMap treats as no price.
 */
export async function refreshPricesForTickers(holdings: PricedHolding[]): Promise<void> {
  if (!holdings.length) return;
  const byKey = new Map(holdings.map((h) => [priceCacheKey(h), h]));

  const now = new Date();
  const equityThreshold = new Date(now.getTime() - EQUITY_TTL_MS);
  const cryptoThreshold = new Date(now.getTime() - CRYPTO_TTL_MS);

  const cached = await prisma.priceCache.findMany({ where: { ticker: { in: [...byKey.keys()] } } });
  const cacheMap = new Map(cached.map((c) => [c.ticker, c]));

  const stale = [...byKey.entries()].filter(([key, holding]) => {
    const entry = cacheMap.get(key);
    const source = priceSourceFor(holding);
    if (!entry || entry.source !== source) return true;
    const lastTried = Math.max(entry.cachedAt.getTime(), failedLookupAt.get(key) ?? 0);
    return lastTried < (source === "coingecko" ? cryptoThreshold : equityThreshold).getTime();
  });
  if (!stale.length) return;
  const staleCryptos = stale.filter(([, h]) => isCryptoHolding(h));
  const staleEquities = stale.filter(([, h]) => !isCryptoHolding(h));

  const [equityResults, cryptoResults] = await Promise.all([
    fetchEquityPrices(staleEquities.map(([, h]) => h.ticker)),
    fetchCryptoPrices(staleCryptos.map(([, h]) => h.ticker)),
  ]);
  const found = new Map<string, PriceResult>();
  for (const r of equityResults) found.set(r.ticker, r);
  for (const r of cryptoResults) found.set(priceCacheKey({ ticker: r.ticker, assetClass: "CRYPTO", exchange: null }), r);

  const lastGoodAfter = new Date(now.getTime() - LAST_GOOD_PRICE_MAX_AGE_MS);
  for (const [key, holding] of stale) {
    const result = found.get(key);
    const source = priceSourceFor(holding);
    const entry = cacheMap.get(key);
    if (result) {
      failedLookupAt.delete(key);
      const data = { price: result.price, currency: result.currency, changePct: result.changePct, source, cachedAt: now };
      await prisma.priceCache.upsert({ where: { ticker: key }, create: { ticker: key, ...data }, update: data });
    } else if (entry && entry.source === source && entry.price > 0 && entry.cachedAt >= lastGoodAfter) {
      // Keep the row (and its fetch time) as it is; retry after the TTL.
      failedLookupAt.set(key, now.getTime());
    } else {
      failedLookupAt.delete(key);
      const data = { price: 0, currency: entry?.currency ?? "AUD", changePct: null, source, cachedAt: now };
      await prisma.priceCache.upsert({ where: { ticker: key }, create: { ticker: key, ...data }, update: data });
    }
  }
}

export async function refreshAllPortfolioPrices(): Promise<void> {
  // CoinGecko rows cached before #404 were keyed by the bare ticker; crypto
  // now uses "cg:" keys (priceCacheKey), so those rows are never read again.
  await prisma.priceCache.deleteMany({ where: { source: "coingecko", NOT: { ticker: { startsWith: "cg:" } } } });
  const holdings = await prisma.holding.findMany({
    select: { ticker: true, exchange: true, assetClass: true },
  });
  await refreshPricesForTickers(holdings);
}

export interface CachedPrice {
  price: number;
  currency: string;
  changePct: number | null;
}

/**
 * Cached prices for these Holdings, by priceCacheKey. Only a usable price
 * (above zero) from the Holding's own feed counts, so a Yahoo price cached
 * for a crypto ticker before #404 is never used.
 */
export async function getPriceMap(holdings: PricedHolding[]): Promise<Map<string, CachedPrice>> {
  if (!holdings.length) return new Map();
  const sources = new Map(holdings.map((h) => [priceCacheKey(h), priceSourceFor(h)]));
  const rows = await prisma.priceCache.findMany({ where: { ticker: { in: [...sources.keys()] } } });
  return new Map(
    rows
      .filter((r) => sources.get(r.ticker) === r.source && Number.isFinite(r.price) && r.price > 0)
      .map((r) => [r.ticker, { price: r.price, currency: r.currency, changePct: r.changePct }]),
  );
}

/**
 * The quote currency Yahoo last reported for an equity ticker, if cached. A
 * row recording a failed lookup (price 0) has no reported currency, only a
 * default, so it gives none.
 */
export async function getQuoteCurrency(ticker: string): Promise<string | null> {
  const row = await prisma.priceCache.findUnique({ where: { ticker }, select: { currency: true, source: true, price: true } });
  return row?.source === "yahoo" && row.price > 0 ? row.currency : null;
}

// ── Historical price functions ───────────────────────────────────────────────

function normaliseDate(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

/** Fetch the closing price for a single ticker on or just before a given date. */
export async function fetchHistoricalPrice(ticker: string, date: Date): Promise<number | null> {
  try {
    const yahooFinance = await getYahooFinance();
    // widen the window by 5 days before to handle weekends/holidays
    const period1 = new Date(date.getTime() - 5 * 24 * 60 * 60 * 1000);
    const period2 = new Date(date.getTime() + 2 * 24 * 60 * 60 * 1000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (await yahooFinance.historical(ticker, { period1, period2, interval: "1d" }, { validateResult: false })) as any[];
    if (!rows?.length) return null;
    const target = date.getTime();
    const eligible = rows.filter((r) => r.date && new Date(r.date).getTime() <= target + 24 * 60 * 60 * 1000);
    if (!eligible.length) return null;
    const row = eligible[eligible.length - 1];
    return (row.adjClose ?? row.close ?? null) as number | null;
  } catch {
    return null;
  }
}

// #432 — bounds on the price-history backfill. Thirty years of daily rows is
// at most about 11,000 (about 7,600 trading days on most exchanges), written
// in short batches, so the cap only guards against a nonsense Trade date.
export const MAX_HISTORY_DAYS = 30 * 365;
// Rows written per batch. Each batch is one lookup of the dates already
// stored plus one createMany, so other requests wait at most one short batch
// for the database rather than the whole backfill (see src/lib/prisma.ts).
const HISTORY_WRITE_BATCH = 250;
// A Yahoo request that hangs would otherwise hold its ticker's in-flight
// entry, and every later backfill of that ticker, until a restart.
export const HISTORY_FETCH_TIMEOUT_MS = 15_000;
// Stored history counts as reaching back to fromDate if it starts within a
// week of it: the first stored row is the first trading day, which can be a
// few days after a weekend or holiday fromDate.
const BACKWARD_GAP_MS = 7 * 24 * 60 * 60 * 1000;

interface HistoryRow {
  date: Date;
  close: number;
  adjClose: number | null;
}

// One backfill per ticker and start date at a time in this process: two tabs
// opening the same Holding share the first fetch instead of writing the same
// rows twice, while a caller asking for an earlier start gets its own run.
const historyInFlight = new Map<string, Promise<void>>();
// Earliest start already fetched backwards per ticker, so a ticker whose
// Yahoo history begins after the earliest Trade isn't re-fetched on every
// view. In-process only: worst case one extra fetch after a restart.
const backwardFetched = new Map<string, number>();

function yieldToOtherRequests(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

/**
 * Fetch and persist daily closing prices for a ticker from `fromDate` (capped
 * at MAX_HISTORY_DAYS ago) to today. Skips crypto Holdings (isCryptoHolding:
 * no Yahoo Finance historical). Fetches only what isn't stored: forwards from two days before
 * the latest stored date, and backwards when `fromDate` is earlier than the
 * earliest stored date. Best-effort: a failed or timed-out fetch leaves what
 * is stored and never throws.
 */
export function fetchAndStorePriceHistory(
  ticker: string,
  holding: PriceRoutingFields,
  fromDate: Date,
): Promise<void> {
  if (isCryptoHolding(holding)) return Promise.resolve();
  const key = `${ticker}|${normaliseDate(fromDate).getTime()}`;
  const pending = historyInFlight.get(key);
  if (pending) return pending;
  const run = backfillPriceHistory(ticker, fromDate)
    .catch(() => {
      // best-effort — don't break the page if historical fetch fails
    })
    .finally(() => {
      historyInFlight.delete(key);
    });
  historyInFlight.set(key, run);
  return run;
}

async function fetchHistoryRows(ticker: string, period1: Date, period2: Date): Promise<HistoryRow[]> {
  const yahooFinance = await getYahooFinance();
  const signal = AbortSignal.timeout(HISTORY_FETCH_TIMEOUT_MS);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`price history fetch for ${ticker} timed out`));
    }, HISTORY_FETCH_TIMEOUT_MS);
  });
  try {
    const rows = (await Promise.race([
      yahooFinance.historical(ticker, { period1, period2, interval: "1d" }, { validateResult: false, fetchOptions: { signal } }),
      timeout,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ])) as any[];
    const byDate = new Map<number, HistoryRow>();
    for (const row of rows ?? []) {
      if (!row?.date || row.close == null) continue;
      const date = normaliseDate(new Date(row.date));
      byDate.set(date.getTime(), { date, close: row.close as number, adjClose: (row.adjClose ?? null) as number | null });
    }
    return [...byDate.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
  } finally {
    clearTimeout(timer);
  }
}

async function backfillPriceHistory(ticker: string, fromDate: Date): Promise<void> {
  const [earliest, latest] = await Promise.all([
    prisma.priceHistory.findFirst({ where: { ticker }, orderBy: { date: "asc" }, select: { date: true } }),
    prisma.priceHistory.findFirst({ where: { ticker }, orderBy: { date: "desc" }, select: { date: true } }),
  ]);

  const now = new Date();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const wantFrom = new Date(Math.max(fromDate.getTime(), now.getTime() - MAX_HISTORY_DAYS * oneDayMs));

  if (!earliest || !latest) {
    await storePriceHistory(ticker, await fetchHistoryRows(ticker, wantFrom, now));
    backwardFetched.set(ticker, wantFrom.getTime());
    return;
  }

  // Older history than what is stored: a Trade dated before the first one
  // this ticker was fetched for (or a second Holding of it).
  const alreadyFetchedFrom = backwardFetched.get(ticker);
  const needsOlder =
    earliest.date.getTime() - wantFrom.getTime() > BACKWARD_GAP_MS &&
    (alreadyFetchedFrom === undefined || alreadyFetchedFrom > wantFrom.getTime());
  if (needsOlder) {
    await storePriceHistory(ticker, await fetchHistoryRows(ticker, wantFrom, earliest.date));
    backwardFetched.set(ticker, wantFrom.getTime());
  }

  // Newer history: from 2 days before the latest stored date (the overlap
  // handles late-arriving data), unless that is from today or yesterday.
  if (now.getTime() - latest.date.getTime() >= 2 * oneDayMs) {
    await storePriceHistory(ticker, await fetchHistoryRows(ticker, new Date(latest.date.getTime() - 2 * oneDayMs), now));
  }
}

// Upsert semantics in batches: dates already stored get their close/adjClose
// updated, new dates are inserted with createMany. One writer, a yield
// between batches, and no transaction spanning batches, so the adapter's
// connection lock is never held for longer than one batch.
async function storePriceHistory(ticker: string, rows: HistoryRow[]): Promise<void> {
  for (let start = 0; start < rows.length; start += HISTORY_WRITE_BATCH) {
    const batch = rows.slice(start, start + HISTORY_WRITE_BATCH);
    const stored = await prisma.priceHistory.findMany({
      where: { ticker, date: { in: batch.map((r) => r.date) } },
      select: { date: true },
    });
    const storedDates = new Set(stored.map((r) => r.date.getTime()));
    const toCreate = batch.filter((r) => !storedDates.has(r.date.getTime()));
    const toUpdate = batch.filter((r) => storedDates.has(r.date.getTime()));

    if (toCreate.length) {
      try {
        await prisma.priceHistory.createMany({
          data: toCreate.map((r) => ({ ticker, date: r.date, close: r.close, adjClose: r.adjClose, source: "yahoo" })),
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // Another writer stored some of these dates in the meantime.
        for (const r of toCreate) {
          await prisma.priceHistory.upsert({
            where: { ticker_date: { ticker, date: r.date } },
            create: { ticker, date: r.date, close: r.close, adjClose: r.adjClose, source: "yahoo" },
            update: { close: r.close, adjClose: r.adjClose },
          });
        }
      }
    }
    for (const r of toUpdate) {
      await prisma.priceHistory.updateMany({
        where: { ticker, date: r.date },
        data: { close: r.close, adjClose: r.adjClose },
      });
    }

    await yieldToOtherRequests();
  }
}

export interface PricePoint {
  date: Date;
  price: number;
}

/** Return stored daily prices for a ticker from fromDate onwards, sorted ascending. */
export async function getPriceHistory(ticker: string, fromDate: Date): Promise<PricePoint[]> {
  const rows = await prisma.priceHistory.findMany({
    where: { ticker, date: { gte: fromDate } },
    orderBy: { date: "asc" },
  });
  return rows.map((r) => ({ date: r.date, price: r.adjClose ?? r.close }));
}
