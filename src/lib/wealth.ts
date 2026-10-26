import { prisma } from "@/lib/prisma";
import { getPriceMap } from "@/lib/prices";
import { priceCacheKey } from "@/lib/priceSource";
import { refreshFxRates, getFxRateMap, convertAmount } from "@/lib/fx";
import type { ModuleKey } from "@/lib/modules/registry";

const NET_WORTH_CURRENCY = "AUD";

// Why a Holding with units isn't counted: no usable price, or a price (or a
// Trade's cost) in a currency with no cached exchange rate.
export type UnpricedReason = "NO_PRICE" | "NO_FX";

export interface HoldingValue {
  holdingId: string;
  ticker: string;
  name: string | null;
  exchange: string | null;
  assetClass: string;
  unitsHeld: number;
  // In the portfolio's currency; null when a Trade's currency can't be
  // converted to it.
  costBasis: number | null;
  currentPrice: number | null;
  currentValue: number | null;
  // currentValue in NET_WORTH_CURRENCY, for ranking holdings across
  // portfolios; null when not counted.
  netWorthValue: number | null;
  // In the portfolio's currency, like costBasis (the price can be in another).
  gainLoss: number | null;
  gainLossPct: number | null;
  changePct: number | null;
  // Currency of currentPrice and currentValue.
  currency: string;
  // Currency of costBasis and gainLoss: the portfolio's.
  costCurrency: string;
  unpricedReason: UnpricedReason | null;
}

export interface PortfolioValue {
  portfolioId: string;
  portfolioName: string;
  // Counted holdings only, in the portfolio's currency.
  totalValue: number;
  // Every holding whose cost converts, priced or not.
  totalCost: number;
  // Cost of the counted holdings only: what totalValue is compared with for
  // the portfolio's gain/loss, so an unpriced holding's cost doesn't show
  // up as a loss.
  pricedCost: number;
  // Holdings with units that aren't counted (see UnpricedReason).
  unpricedCount: number;
  holdings: HoldingValue[];
}

export type NetWorthComponentKey = "INVESTMENTS" | "PROPERTY" | "ITEMS";

export interface NetWorthComponent {
  key: NetWorthComponentKey;
  label: string;
  value: number;
}

// What the total leaves out, by kind, so every part is either listed or
// explained (#404).
export interface NetWorthExclusions {
  // Holdings with no price or exchange rate.
  holdings: number;
  // Portfolios whose currency has no rate to NET_WORTH_CURRENCY.
  portfolios: number;
  // Properties whose latest valuation's currency has no rate.
  properties: number;
  // Items whose purchase price's currency has no rate.
  items: number;
}

export interface NetWorthData {
  sharesValue: number;
  propertyValue: number;
  inventoryValue: number;
  // Always the sum of `components` (#404): every part of the total is listed.
  totalNetWorth: number;
  components: NetWorthComponent[];
  // Holdings across all portfolios not counted in the total.
  unpricedCount: number;
  excluded: NetWorthExclusions;
  portfolios: PortfolioValue[];
  propertyStale: boolean; // any property has no valuation in last 12 months
  currency: string;
}

/**
 * The parts of net worth, one per source that's switched on: investments
 * always (this is the Wealth module), Property with HOME, Items with
 * INVENTORY. The total is computed from this list, so the list shown beside
 * it always adds up to it (#404: Items were in the total but had no tile).
 */
export function netWorthComponents(
  values: { investments: number; property: number; items: number },
  enabledModules: Set<ModuleKey>,
): { components: NetWorthComponent[]; total: number } {
  const components: NetWorthComponent[] = [
    { key: "INVESTMENTS", label: "Shares, ETFs and crypto", value: values.investments },
  ];
  if (enabledModules.has("HOME")) components.push({ key: "PROPERTY", label: "Property", value: values.property });
  if (enabledModules.has("INVENTORY")) components.push({ key: "ITEMS", label: "Items", value: values.items });
  return { components, total: components.reduce((s, c) => s + c.value, 0) };
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "N holdings have no price or exchange rate and aren't counted." */
export function unpricedHoldingsNote(count: number): string | null {
  if (count <= 0) return null;
  return `${plural(count, "holding has", "holdings have")} no price or exchange rate and ${count === 1 ? "isn't" : "aren't"} counted.`;
}

/**
 * One plain sentence naming everything the net-worth total leaves out, or
 * null when nothing is left out.
 */
export function netWorthExclusionNote(excluded: NetWorthExclusions): string | null {
  const parts = [
    excluded.holdings > 0 ? `${plural(excluded.holdings, "holding", "holdings")} with no price or exchange rate` : null,
    excluded.portfolios > 0 ? `${plural(excluded.portfolios, "portfolio", "portfolios")} with no exchange rate` : null,
    excluded.properties > 0 ? `${plural(excluded.properties, "property", "properties")} with no exchange rate` : null,
    excluded.items > 0 ? `${plural(excluded.items, "item", "items")} with no exchange rate` : null,
  ].filter((p): p is string => p != null);
  return parts.length ? `Not counted: ${parts.join(", ")}.` : null;
}

export interface ValuedHolding {
  currentPrice: number | null;
  currentValue: number | null;
  // currentValue converted to the portfolio's currency; null when not counted.
  portfolioValue: number | null;
  gainLoss: number | null;
  gainLossPct: number | null;
  unpricedReason: UnpricedReason | null;
}

/**
 * Values one Holding. A missing, zero or non-finite price leaves it unpriced
 * (#404): no value, no gain/loss, rather than a wildly wrong figure such as
 * BTC at Yahoo's ETF price showing -99.9%. Gain/loss compares like with
 * like: the value is converted to the portfolio's currency (the cost
 * basis's) first. A missing rate for the price, or a cost that couldn't be
 * converted (cost null), leaves it uncounted with reason NO_FX.
 */
export function valueHolding(input: {
  units: number;
  cost: number | null;
  price: number | null | undefined;
  priceCurrency: string;
  portfolioCurrency: string;
  rateMap: Map<string, number>;
}): ValuedHolding {
  const { units, cost, priceCurrency, portfolioCurrency, rateMap } = input;
  const price = input.price != null && Number.isFinite(input.price) && input.price > 0 ? input.price : null;
  const none = { currentValue: null, portfolioValue: null, gainLoss: null, gainLossPct: null };
  if (units <= 0) return { currentPrice: price, ...none, unpricedReason: null };
  if (price == null) return { currentPrice: null, ...none, unpricedReason: "NO_PRICE" };
  const currentValue = units * price;
  const portfolioValue = convertAmount(currentValue, priceCurrency, portfolioCurrency, rateMap);
  if (portfolioValue == null || cost == null) {
    return { currentPrice: price, ...none, currentValue, unpricedReason: "NO_FX" };
  }
  const gainLoss = portfolioValue - cost;
  const gainLossPct = cost > 0 ? (gainLoss / cost) * 100 : null;
  return { currentPrice: price, currentValue, portfolioValue, gainLoss, gainLossPct, unpricedReason: null };
}

export type CostMethod = "FIFO" | "AVERAGE";

type CostBasisTrade = { type: string; units: number; pricePerUnit: number; fees: number | null };

type CurrencyTrade = CostBasisTrade & { currency: string; fxRate: number | null };

/**
 * A Trade's price and fees in the portfolio's currency (#404 review: cost
 * used to sum raw amounts across Trade currencies). Uses the Trade's own
 * "FX rate to AUD" when the portfolio is in AUD and one was entered (the
 * rate on the Trade date, AUD per unit of the Trade's currency); otherwise
 * today's cached rate. Returns null when neither is available.
 */
export function tradeInCurrency<T extends CurrencyTrade>(
  trade: T,
  currency: string,
  rateMap: Map<string, number>,
): T | null {
  if (trade.currency === currency) return trade;
  const tradeDateRate = currency === "AUD" && trade.fxRate != null && trade.fxRate > 0 ? trade.fxRate : null;
  const rate = tradeDateRate ?? convertAmount(1, trade.currency, currency, rateMap);
  if (rate == null) return null;
  return { ...trade, pricePerUnit: trade.pricePerUnit * rate, fees: trade.fees != null ? trade.fees * rate : null };
}

/**
 * Units and cost basis in `currency`. Units never depend on a rate; cost is
 * null when any Trade can't be converted, rather than a guess.
 */
export function holdingUnitsAndCostIn(
  trades: CurrencyTrade[],
  method: CostMethod,
  currency: string,
  rateMap: Map<string, number>,
): { units: number; cost: number | null } {
  const converted = trades.map((t) => tradeInCurrency(t, currency, rateMap));
  if (converted.every((t): t is CurrencyTrade => t != null)) return holdingUnitsAndCost(converted, method);
  return { units: holdingUnitsAndCost(trades, method).units, cost: null };
}

// Trades must be sorted ascending by date. FIFO tracks individual purchase
// lots and consumes the oldest first on a sale; average cost pools everything
// bought so far and reduces it proportionally. Both clamp a sale exceeding
// units held to zero, rather than going negative. Configurable per portfolio
// (#275) — the two methods diverge materially whenever units are bought at
// different prices and then partially sold.
export function holdingUnitsAndCost(trades: CostBasisTrade[], method: CostMethod = "FIFO") {
  if (method === "AVERAGE") {
    let units = 0;
    let cost = 0;
    for (const t of trades) {
      if (t.type === "BUY") {
        units += t.units;
        cost += t.units * t.pricePerUnit + (t.fees ?? 0);
      } else if (t.type === "SELL") {
        const sellUnits = Math.min(t.units, units);
        if (units > 0) {
          cost = cost * ((units - sellUnits) / units);
        }
        units = Math.max(0, units - sellUnits);
      } else if (t.type === "SPLIT") {
        units += t.units;
      }
      // DIVIDEND: cash in, no unit change
    }
    return { units, cost };
  }

  const lots: { units: number; cost: number }[] = [];
  for (const t of trades) {
    if (t.type === "BUY") {
      lots.push({ units: t.units, cost: t.units * t.pricePerUnit + (t.fees ?? 0) });
    } else if (t.type === "SELL") {
      let remaining = t.units;
      while (remaining > 0 && lots.length > 0) {
        const lot = lots[0];
        if (lot.units <= remaining) {
          remaining -= lot.units;
          lots.shift();
        } else {
          lot.cost -= lot.cost * (remaining / lot.units);
          lot.units -= remaining;
          remaining = 0;
        }
      }
    } else if (t.type === "SPLIT") {
      lots.push({ units: t.units, cost: 0 });
    }
    // DIVIDEND: cash in, no unit change
  }
  return {
    units: lots.reduce((s, l) => s + l.units, 0),
    cost: lots.reduce((s, l) => s + l.cost, 0),
  };
}

export async function getNetWorth(enabledModules: Set<ModuleKey>): Promise<NetWorthData> {
  const [portfolios, properties, inventoryItems] = await Promise.all([
    prisma.portfolio.findMany({
      include: {
        holdings: {
          include: { trades: { orderBy: { date: "asc" } } },
        },
      },
    }),
    enabledModules.has("HOME")
      ? prisma.property.findMany({
          where: { deletedAt: null },
          include: { valuations: { orderBy: { valuedAt: "desc" }, take: 1 } },
        })
      : [],
    enabledModules.has("INVENTORY")
      ? prisma.inventoryItem.findMany({
          where: { deletedAt: null },
          select: { purchasePrice: true, currency: true },
        })
      : [],
  ]);

  const priceMap = await getPriceMap(portfolios.flatMap((p) => p.holdings));

  // Every currency any amount is in: portfolio, price, Trade, property
  // valuation and item purchase price. Prices and Trades convert to their
  // portfolio's currency, everything else to NET_WORTH_CURRENCY.
  const fxPairs: { from: string; to: string }[] = [];
  for (const portfolio of portfolios) {
    fxPairs.push({ from: portfolio.currency, to: NET_WORTH_CURRENCY });
    for (const holding of portfolio.holdings) {
      const priceCurrency = priceMap.get(priceCacheKey(holding))?.currency;
      if (priceCurrency) fxPairs.push({ from: priceCurrency, to: portfolio.currency });
      for (const trade of holding.trades) fxPairs.push({ from: trade.currency, to: portfolio.currency });
    }
  }
  for (const property of properties) {
    const currency = property.valuations[0]?.currency;
    if (currency) fxPairs.push({ from: currency, to: NET_WORTH_CURRENCY });
  }
  for (const item of inventoryItems) fxPairs.push({ from: item.currency, to: NET_WORTH_CURRENCY });
  await refreshFxRates(fxPairs);
  const rateMap = await getFxRateMap(fxPairs);

  const excluded: NetWorthExclusions = { holdings: 0, portfolios: 0, properties: 0, items: 0 };

  const portfolioValues: PortfolioValue[] = portfolios.map((portfolio) => {
    let totalValue = 0;
    let totalCost = 0;
    let pricedCost = 0;
    let unpricedCount = 0;
    const holdingValues: HoldingValue[] = portfolio.holdings.map((holding) => {
      const { units, cost } = holdingUnitsAndCostIn(holding.trades, portfolio.costMethod, portfolio.currency, rateMap);
      const priceEntry = priceMap.get(priceCacheKey(holding));
      const currency = priceEntry?.currency ?? portfolio.currency;
      const valued = valueHolding({
        units,
        cost,
        price: priceEntry?.price,
        priceCurrency: currency,
        portfolioCurrency: portfolio.currency,
        rateMap,
      });
      totalCost += cost ?? 0;
      if (valued.portfolioValue != null) {
        totalValue += valued.portfolioValue;
        pricedCost += cost ?? 0;
      }
      if (valued.unpricedReason) unpricedCount++;
      return {
        holdingId: holding.id,
        ticker: holding.ticker,
        name: holding.name,
        exchange: holding.exchange,
        assetClass: holding.assetClass,
        unitsHeld: units,
        costBasis: cost,
        currentPrice: valued.currentPrice,
        currentValue: valued.currentValue,
        netWorthValue:
          valued.portfolioValue != null
            ? convertAmount(valued.portfolioValue, portfolio.currency, NET_WORTH_CURRENCY, rateMap)
            : null,
        gainLoss: valued.gainLoss,
        gainLossPct: valued.gainLossPct,
        changePct: valued.currentPrice != null ? (priceEntry?.changePct ?? null) : null,
        currency,
        costCurrency: portfolio.currency,
        unpricedReason: valued.unpricedReason,
      };
    });
    excluded.holdings += unpricedCount;

    return {
      portfolioId: portfolio.id,
      portfolioName: portfolio.name,
      totalValue,
      totalCost,
      pricedCost,
      unpricedCount,
      holdings: holdingValues,
    };
  });

  // Each portfolio's total is in its own currency (as shown on its own
  // page); convert before summing across portfolios.
  let sharesValue = 0;
  portfolioValues.forEach((p, i) => {
    if (p.totalValue === 0) return;
    const converted = convertAmount(p.totalValue, portfolios[i].currency, NET_WORTH_CURRENCY, rateMap);
    if (converted == null) excluded.portfolios++;
    else sharesValue += converted;
  });

  // Property valuations
  const twelveMonthsAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  let propertyValue = 0;
  let propertyStale = false;

  for (const property of properties) {
    const latest = property.valuations[0];
    if (latest) {
      const converted = convertAmount(latest.value, latest.currency, NET_WORTH_CURRENCY, rateMap);
      if (converted == null) excluded.properties++;
      else propertyValue += converted;
      if (latest.valuedAt < twelveMonthsAgo) propertyStale = true;
    } else {
      propertyStale = true;
    }
  }

  // Items (the Inventory module), at purchase price
  let inventoryValue = 0;
  for (const item of inventoryItems) {
    if (item.purchasePrice == null) continue;
    const converted = convertAmount(item.purchasePrice, item.currency, NET_WORTH_CURRENCY, rateMap);
    if (converted == null) excluded.items++;
    else inventoryValue += converted;
  }

  const { components, total } = netWorthComponents(
    { investments: sharesValue, property: propertyValue, items: inventoryValue },
    enabledModules,
  );

  return {
    sharesValue,
    propertyValue,
    inventoryValue,
    totalNetWorth: total,
    components,
    unpricedCount: excluded.holdings,
    excluded,
    portfolios: portfolioValues,
    propertyStale,
    currency: NET_WORTH_CURRENCY,
  };
}
