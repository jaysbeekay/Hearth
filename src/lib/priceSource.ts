// #404 — which price feed a Holding is priced from. Kept free of Prisma and
// network imports so the routing rule can be shared by live prices
// (src/lib/prices.ts), the Trade-date backfill and CSV import
// (src/lib/commands/wealth.ts) and the pages, and tested on its own.

export type PriceSource = "coingecko" | "yahoo";

export interface PriceRoutingFields {
  assetClass: string | null;
  exchange: string | null;
}

export interface PricedHolding extends PriceRoutingFields {
  ticker: string;
}

function isCryptoLabel(value: string | null | undefined): boolean {
  return (value ?? "").trim().toUpperCase() === "CRYPTO";
}

/**
 * A Holding is crypto when its asset class is CRYPTO. The exchange is the
 * fallback: Holdings saved before asset class was routed on (or imported as
 * the default SHARE) marked crypto by setting the exchange to CRYPTO.
 * Before #404 only the exchange counted, so a CRYPTO "BTC" with a blank
 * exchange was looked up on Yahoo, where BTC is an ETF.
 */
export function isCryptoHolding(holding: PriceRoutingFields): boolean {
  return isCryptoLabel(holding.assetClass) || isCryptoLabel(holding.exchange);
}

export function priceSourceFor(holding: PriceRoutingFields): PriceSource {
  return isCryptoHolding(holding) ? "coingecko" : "yahoo";
}

const CRYPTO_KEY_PREFIX = "cg:";

/**
 * The price cache row (and price map entry) for a Holding. Crypto is
 * namespaced, "cg:" plus the lowercased ticker, so a crypto "BTC" and the
 * BTC ETF never share a price (#404). Equities keep the bare ticker, which
 * is what every row cached before #404 used.
 */
export function priceCacheKey(holding: PricedHolding): string {
  return isCryptoHolding(holding) ? `${CRYPTO_KEY_PREFIX}${holding.ticker.trim().toLowerCase()}` : holding.ticker;
}

/**
 * Asset class for a Holding that CSV import creates. Only an Asset Class
 * column saying crypto, or an Exchange column of CRYPTO, makes it CRYPTO;
 * everything else is a SHARE, as before #404. The ticker alone is never
 * enough: BTC, ETH, SOL, LINK and others are also listed ETFs and shares,
 * so a guess would price a BTC ETF as bitcoin (#404 review).
 */
export function inferImportedAssetClass(row: {
  assetClass?: string | null;
  exchange?: string | null;
}): "CRYPTO" | "SHARE" {
  return isCryptoLabel(row.assetClass) || isCryptoLabel(row.exchange) ? "CRYPTO" : "SHARE";
}
