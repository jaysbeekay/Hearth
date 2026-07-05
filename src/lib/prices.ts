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
