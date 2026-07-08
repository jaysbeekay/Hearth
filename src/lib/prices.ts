import { prisma } from "@/lib/prisma";

const EQUITY_TTL_MS = 15 * 60 * 1000; // 15 minutes
const CRYPTO_TTL_MS = 5 * 60 * 1000;  // 5 minutes

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
    const yahooFinance = (await import("yahoo-finance2")).default;
    const results: PriceResult[] = [];
    for (const symbol of symbols) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const quote = (await yahooFinance.quote(symbol, {}, { validateResult: false })) as any;
        if (quote?.regularMarketPrice != null) {
          results.push({
            ticker: symbol,
            price: quote.regularMarketPrice as number,
            currency: ((quote.currency as string | undefined) ?? "USD").toUpperCase(),
            changePct: (quote.regularMarketChangePercent as number | undefined) ?? null,
            source: "yahoo",
          });
        }
      } catch {
        // individual symbol failure — skip
      }
    }
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
    const yahooFinance = (await import("yahoo-finance2")).default;
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

/**
 * Fetch and persist daily closing prices for a ticker from `fromDate` to today.
 * Skips crypto (no Yahoo Finance historical). Only re-fetches from the last stored
 * date to avoid redundant API calls.
 */
export async function fetchAndStorePriceHistory(
  ticker: string,
  exchange: string | null,
  fromDate: Date,
): Promise<void> {
  if (exchange === "CRYPTO") return;

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

  // Fetch from 2 days before latest (overlap handles late-arriving data) or fromDate if no history
  const fetchFrom = latest
    ? new Date(latest.date.getTime() - 2 * oneDayMs)
    : fromDate;

  try {
    const yahooFinance = (await import("yahoo-finance2")).default;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (await yahooFinance.historical(ticker, { period1: fetchFrom, period2: now, interval: "1d" }, { validateResult: false })) as any[];
    if (!rows?.length) return;

    for (const row of rows) {
      if (!row.date || row.close == null) continue;
      const date = normaliseDate(new Date(row.date));
      const close = row.close as number;
      const adjClose = (row.adjClose ?? null) as number | null;
      await prisma.priceHistory.upsert({
        where: { ticker_date: { ticker, date } },
        create: { ticker, date, close, adjClose, source: "yahoo" },
        update: { close, adjClose },
      });
    }
  } catch {
    // best-effort — don't break the page if historical fetch fails
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
