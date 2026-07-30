import { z } from "zod";

const emptyToUndefined = (val: unknown) =>
  val == null || (typeof val === "string" && val.trim() === "") ? undefined : val;

export const ASSET_CLASSES = ["SHARE", "ETF", "MANAGED_FUND", "CRYPTO", "CASH", "OTHER"] as const;
export const TRADE_TYPES = ["BUY", "SELL", "DIVIDEND", "SPLIT"] as const;

export const ASSET_CLASS_LABELS: Record<string, string> = {
  SHARE: "Share",
  ETF: "ETF",
  MANAGED_FUND: "Managed Fund",
  CRYPTO: "Crypto",
  CASH: "Cash",
  OTHER: "Other",
};

export const TRADE_TYPE_LABELS: Record<string, string> = {
  BUY: "Buy",
  SELL: "Sell",
  DIVIDEND: "Dividend",
  SPLIT: "Split",
};

export const portfolioSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  description: z.preprocess(emptyToUndefined, z.string().trim().max(500).optional()),
  currency: z.string().trim().min(1).max(10).default("AUD"),
});

export const holdingSchema = z.object({
  ticker: z
    .string()
    .trim()
    .min(1, "Ticker is required")
    .max(20)
    .transform((v) => v.toUpperCase()),
  name: z.preprocess(emptyToUndefined, z.string().trim().max(200).optional()),
  assetClass: z.enum(ASSET_CLASSES).default("SHARE"),
  exchange: z.preprocess(emptyToUndefined, z.string().trim().max(20).optional()),
});

export const tradeSchema = z.object({
  type: z.enum(TRADE_TYPES),
  date: z.coerce.date(),
  units: z.coerce.number().positive("Units must be positive"),
  pricePerUnit: z.coerce.number().min(0, "Price must be 0 or more"),
  fees: z.preprocess(emptyToUndefined, z.coerce.number().min(0).optional()),
  currency: z.string().trim().min(1).max(10).default("AUD"),
  fxRate: z.preprocess(emptyToUndefined, z.coerce.number().positive().optional()),
  notes: z.preprocess(emptyToUndefined, z.string().trim().max(2000).optional()),
});

export const propertyValuationSchema = z.object({
  valuedAt: z.coerce.date(),
  value: z.coerce.number().min(0, "Value must be 0 or more"),
  currency: z.string().trim().min(1).max(10).default("AUD"),
  source: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  notes: z.preprocess(emptyToUndefined, z.string().trim().max(2000).optional()),
});

export type PortfolioInput = z.infer<typeof portfolioSchema>;
export type HoldingInput = z.infer<typeof holdingSchema>;
export type TradeInput = z.infer<typeof tradeSchema>;
export type PropertyValuationInput = z.infer<typeof propertyValuationSchema>;

// importTrades is a server action taking an array straight from the client.
// TypeScript's ParsedTrade[] annotation is erased at runtime, so before this
// the action trusted whatever JSON arrived: NaN or Infinity for units/price
// (SQLite stores them, then every FIFO cost-basis calculation downstream
// yields NaN), an arbitrary string for `type` where the column is an enum, or
// an unbounded number of rows (#162).
export const importedTradeSchema = z.object({
  ticker: z.string().trim().min(1).max(32),
  type: z.enum(TRADE_TYPES),
  date: z.string().trim().min(1).max(40),
  // .finite() is the point: z.number() alone accepts NaN and ±Infinity.
  units: z.number().finite().positive().max(1e12),
  pricePerUnit: z.number().finite().min(0).max(1e12),
  fees: z.number().finite().min(0).max(1e12),
  currency: z.string().trim().min(1).max(10),
});

// A household's brokerage export is thousands of rows at the very most, and
// each row costs an upsert plus a duplicate lookup.
export const MAX_IMPORTED_TRADES = 5000;

export const importedTradesSchema = z
  .array(importedTradeSchema)
  .min(1, "There are no trades to import.")
  .max(MAX_IMPORTED_TRADES, `Import at most ${MAX_IMPORTED_TRADES} trades at a time.`);
