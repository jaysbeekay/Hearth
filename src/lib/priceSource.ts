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
