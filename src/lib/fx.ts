import { prisma } from "@/lib/prisma";

const FX_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours — budgeting/net-worth accuracy, not trading

function pairKey(from: string, to: string): string {
  return `${from}_${to}`;
}

async function fetchFxRate(from: string, to: string): Promise<number | null> {
  try {
    const YahooFinance = (await import("yahoo-finance2")).default;
    const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quote = (await yahooFinance.quote(`${from}${to}=X`, {}, { validateResult: false })) as any;
    const rate = quote?.regularMarketPrice as number | undefined;
    return rate != null && rate > 0 ? rate : null;
  } catch {
    return null;
  }
}

/**
 * Fetch and cache conversion rates for the given currency pairs. Pairs where
 * from === to are skipped (rate is always 1, handled by convertAmount without
 * a cache lookup).
 */
export async function refreshFxRates(pairs: { from: string; to: string }[]): Promise<void> {
  const distinctPairs = [...new Map(pairs.filter((p) => p.from !== p.to).map((p) => [pairKey(p.from, p.to), p])).values()];
  if (!distinctPairs.length) return;

  const now = new Date();
  const threshold = new Date(now.getTime() - FX_TTL_MS);

  const cached = await prisma.fxRate.findMany({
    where: { pair: { in: distinctPairs.map((p) => pairKey(p.from, p.to)) } },
  });
  const cacheMap = new Map(cached.map((c) => [c.pair, c]));

  const stale = distinctPairs.filter((p) => {
    const entry = cacheMap.get(pairKey(p.from, p.to));
    return !entry || entry.cachedAt < threshold;
  });
  if (!stale.length) return;

  const results = await Promise.all(
    stale.map(async (p) => ({ pair: pairKey(p.from, p.to), rate: await fetchFxRate(p.from, p.to) })),
  );

  await Promise.all(
    results
      .filter((r) => r.rate != null)
      .map((r) =>
        prisma.fxRate.upsert({
          where: { pair: r.pair },
          create: { pair: r.pair, rate: r.rate as number, cachedAt: now },
          update: { rate: r.rate as number, cachedAt: now },
        }),
      ),
  );
}

/** Returns cached rates keyed by "FROM_TO", covering only the requested pairs. */
export async function getFxRateMap(pairs: { from: string; to: string }[]): Promise<Map<string, number>> {
  const distinctPairs = [...new Map(pairs.filter((p) => p.from !== p.to).map((p) => [pairKey(p.from, p.to), p])).values()];
  if (!distinctPairs.length) return new Map();

  const rows = await prisma.fxRate.findMany({
    where: { pair: { in: distinctPairs.map((p) => pairKey(p.from, p.to)) } },
  });
  return new Map(rows.map((r) => [r.pair, r.rate]));
}

/**
 * Convert an amount from one currency to another using a rate map from
 * getFxRateMap(). Returns null (rather than the raw, unconverted amount) when
 * no rate is available, so callers can exclude it from a sum instead of
 * silently mixing currencies.
 */
export function convertAmount(
  amount: number,
  from: string,
  to: string,
  rateMap: Map<string, number>,
): number | null {
  if (from === to) return amount;
  const rate = rateMap.get(pairKey(from, to));
  return rate != null ? amount * rate : null;
}
