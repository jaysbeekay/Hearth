import { prisma } from "@/lib/prisma";

const EQUITY_TTL_MS = 15 * 60 * 1000; // 15 minutes
const CRYPTO_TTL_MS = 5 * 60 * 1000;  // 5 minutes

// yahoo-finance2 v3 requires instantiating the default export rather than
// calling its methods directly (v2-style) — https://github.com/gadicc/yahoo-finance2/blob/dev/docs/UPGRADING.md
async function getYahooFinance() {
  const YahooFinance = (await import("yahoo-finance2")).default;
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

export async function fetchCryptoPrices(coinIds: string[]): Promise<PriceResult[]> {
  if (!coinIds.length) return [];
  try {
    const ids = coinIds.map((id) => id.toLowerCase()).join(",");
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=aud&include_24hr_change=true`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const data = (await res.json()) as Record<string, { aud?: number; aud_24h_change?: number }>;
    return coinIds.flatMap((id) => {
      const row = data[id.toLowerCase()];
      if (!row?.aud) return [];
      return [
        {
          ticker: id,
          price: row.aud,
          currency: "AUD",
          changePct: row.aud_24h_change ?? null,
          source: "coingecko",
        },
      ];
    });
  } catch {
    return [];
  }
}

export async function refreshPricesForTickers(
  tickers: { ticker: string; exchange: string | null }[],
): Promise<void> {
  if (!tickers.length) return;

  const now = new Date();
  const equityThreshold = new Date(now.getTime() - EQUITY_TTL_MS);
  const cryptoThreshold = new Date(now.getTime() - CRYPTO_TTL_MS);

  const cached = await prisma.priceCache.findMany({
    where: { ticker: { in: tickers.map((t) => t.ticker) } },
  });
  const cacheMap = new Map(cached.map((c) => [c.ticker, c]));

  const staleEquities = tickers.filter(({ ticker, exchange }) => {
    if (exchange === "CRYPTO") return false;
    const entry = cacheMap.get(ticker);
    return !entry || entry.cachedAt < equityThreshold;
  });

  const staleCryptos = tickers.filter(({ ticker, exchange }) => {
    if (exchange !== "CRYPTO") return false;
    const entry = cacheMap.get(ticker);
    return !entry || entry.cachedAt < cryptoThreshold;
  });

  const [equityResults, cryptoResults] = await Promise.all([
    fetchEquityPrices(staleEquities.map((t) => t.ticker)),
    fetchCryptoPrices(staleCryptos.map((t) => t.ticker)),
  ]);

  const allResults = [...equityResults, ...cryptoResults];
  if (!allResults.length) return;

  await Promise.all(
    allResults.map((r) =>
      prisma.priceCache.upsert({
        where: { ticker: r.ticker },
        create: { ...r, cachedAt: now },
        update: { price: r.price, currency: r.currency, changePct: r.changePct, cachedAt: now },
      }),
    ),
  );
}

export async function refreshAllPortfolioPrices(): Promise<void> {
  const holdings = await prisma.holding.findMany({
    distinct: ["ticker"],
    select: { ticker: true, exchange: true },
  });
  await refreshPricesForTickers(holdings);
}

export async function getPriceMap(tickers: string[]): Promise<Map<string, { price: number; currency: string; changePct: number | null }>> {
  if (!tickers.length) return new Map();
  const rows = await prisma.priceCache.findMany({ where: { ticker: { in: tickers } } });
  return new Map(rows.map((r) => [r.ticker, { price: r.price, currency: r.currency, changePct: r.changePct }]));
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

// #432 — bounds on the price-history backfill. Ten years of trading days is
// about 2,500 rows; a Holding whose earliest Trade is older than that charts
// from the cap onwards rather than pulling decades of history in one go.
export const MAX_HISTORY_DAYS = 3653;
// Rows written per batch. Each batch is one createMany plus a lookup of the
// dates already stored, so other requests wait at most one short batch for
// the database rather than the whole backfill (see src/lib/prisma.ts).
const HISTORY_WRITE_BATCH = 250;

interface HistoryRow {
  date: Date;
  close: number;
  adjClose: number | null;
}

// One backfill per ticker at a time in this process: two tabs opening the
// same Holding share the first fetch instead of writing the same rows twice.
const historyInFlight = new Map<string, Promise<void>>();

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
 * at MAX_HISTORY_DAYS ago) to today. Skips crypto (no Yahoo Finance
 * historical). Only re-fetches from the last stored date to avoid redundant
 * API calls. Best-effort: a failed fetch leaves what is stored and never
 * throws.
 */
export async function fetchAndStorePriceHistory(
  ticker: string,
  exchange: string | null,
  fromDate: Date,
): Promise<void> {
  if (exchange === "CRYPTO") return;
  const pending = historyInFlight.get(ticker);
  if (pending) return pending;
  const run = backfillPriceHistory(ticker, fromDate).finally(() => {
    historyInFlight.delete(ticker);
  });
  historyInFlight.set(ticker, run);
  return run;
}

async function backfillPriceHistory(ticker: string, fromDate: Date): Promise<void> {
  try {
    // Find the most recent stored date to avoid re-fetching the whole history
    const latest = await prisma.priceHistory.findFirst({
      where: { ticker },
      orderBy: { date: "desc" },
      select: { date: true },
    });

    const now = new Date();
    const oneDayMs = 24 * 60 * 60 * 1000;

    // If latest price is from today or yesterday (allowing for market hours), nothing to do
    if (latest && now.getTime() - latest.date.getTime() < 2 * oneDayMs) return;

    // Fetch from 2 days before latest (overlap handles late-arriving data) or
    // fromDate if no history, never further back than the cap.
    const earliestAllowed = now.getTime() - MAX_HISTORY_DAYS * oneDayMs;
    const fetchFrom = new Date(
      Math.max(latest ? latest.date.getTime() - 2 * oneDayMs : fromDate.getTime(), earliestAllowed),
    );

    const yahooFinance = await getYahooFinance();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (await yahooFinance.historical(ticker, { period1: fetchFrom, period2: now, interval: "1d" }, { validateResult: false })) as any[];
    if (!rows?.length) return;

    const byDate = new Map<number, HistoryRow>();
    for (const row of rows) {
      if (!row?.date || row.close == null) continue;
      const date = normaliseDate(new Date(row.date));
      byDate.set(date.getTime(), { date, close: row.close as number, adjClose: (row.adjClose ?? null) as number | null });
    }
    await storePriceHistory(ticker, [...byDate.values()].sort((a, b) => a.date.getTime() - b.date.getTime()));
  } catch {
    // best-effort — don't break the page if historical fetch fails
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
        // Another process stored some of these dates in the meantime.
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
