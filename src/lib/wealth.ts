import { prisma } from "@/lib/prisma";
import { getPriceMap } from "@/lib/prices";
import { refreshFxRates, getFxRateMap, convertAmount } from "@/lib/fx";
import type { ModuleKey } from "@/lib/modules/registry";

const NET_WORTH_CURRENCY = "AUD";

export interface HoldingValue {
  holdingId: string;
  ticker: string;
  name: string | null;
  exchange: string | null;
  assetClass: string;
  unitsHeld: number;
  costBasis: number;
  currentPrice: number | null;
  currentValue: number | null;
  // In the portfolio's currency, like costBasis (the price can be in another).
  gainLoss: number | null;
  gainLossPct: number | null;
  changePct: number | null;
  // Currency of currentPrice and currentValue.
  currency: string;
  // Currency of costBasis and gainLoss: the portfolio's.
  costCurrency: string;
}

export interface PortfolioValue {
  portfolioId: string;
  portfolioName: string;
  totalValue: number;
  totalCost: number;
  // Holdings with units but no usable price (or no FX rate to the
  // portfolio's currency): left out of totalValue, shown as "No price".
  unpricedCount: number;
  holdings: HoldingValue[];
}

export type NetWorthComponentKey = "INVESTMENTS" | "PROPERTY" | "ITEMS";

export interface NetWorthComponent {
  key: NetWorthComponentKey;
  label: string;
  value: number;
}

export interface NetWorthData {
  sharesValue: number;
  propertyValue: number;
  inventoryValue: number;
  // Always the sum of `components` (#404): every part of the total is listed.
  totalNetWorth: number;
  components: NetWorthComponent[];
  // Holdings across all portfolios not counted in the total for want of a price.
  unpricedCount: number;
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

export interface ValuedHolding {
  currentPrice: number | null;
  currentValue: number | null;
  // currentValue converted to the portfolio's currency; null when unpriced.
  portfolioValue: number | null;
  gainLoss: number | null;
  gainLossPct: number | null;
  unpriced: boolean;
}

/**
 * Values one Holding. A missing, zero or non-finite price leaves it unpriced
 * (#404): no value, no gain/loss, rather than a wildly wrong figure such as
 * BTC at Yahoo's ETF price showing -99.9%. Gain/loss compares like with
 * like: the value is converted to the portfolio's currency (the cost
 * basis's) first, and stays blank when no FX rate is cached.
 */
export function valueHolding(input: {
  units: number;
  cost: number;
  price: number | null | undefined;
  priceCurrency: string;
  portfolioCurrency: string;
  rateMap: Map<string, number>;
}): ValuedHolding {
  const { units, cost, priceCurrency, portfolioCurrency, rateMap } = input;
  const price = input.price != null && Number.isFinite(input.price) && input.price > 0 ? input.price : null;
  if (price == null) {
    return { currentPrice: null, currentValue: null, portfolioValue: null, gainLoss: null, gainLossPct: null, unpriced: units > 0 };
  }
  if (units <= 0) {
    return { currentPrice: price, currentValue: null, portfolioValue: null, gainLoss: null, gainLossPct: null, unpriced: false };
  }
  const currentValue = units * price;
  const portfolioValue = convertAmount(currentValue, priceCurrency, portfolioCurrency, rateMap);
  const gainLoss = portfolioValue != null ? portfolioValue - cost : null;
  const gainLossPct = gainLoss != null && cost > 0 ? (gainLoss / cost) * 100 : null;
  return { currentPrice: price, currentValue, portfolioValue, gainLoss, gainLossPct, unpriced: portfolioValue == null };
}

export type CostMethod = "FIFO" | "AVERAGE";

type CostBasisTrade = { type: string; units: number; pricePerUnit: number; fees: number | null };

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

  // Every currency any amount is in: portfolio, price, property valuation
  // and item purchase price. Prices convert to their portfolio's currency
  // (for the portfolio total and gain/loss), everything to NET_WORTH_CURRENCY.
  const fxPairs: { from: string; to: string }[] = [];
  for (const portfolio of portfolios) {
    fxPairs.push({ from: portfolio.currency, to: NET_WORTH_CURRENCY });
    for (const holding of portfolio.holdings) {
      const priceCurrency = priceMap.get(holding.ticker)?.currency;
      if (priceCurrency) fxPairs.push({ from: priceCurrency, to: portfolio.currency });
    }
  }
  for (const property of properties) {
    const currency = property.valuations[0]?.currency;
    if (currency) fxPairs.push({ from: currency, to: NET_WORTH_CURRENCY });
  }
  for (const item of inventoryItems) fxPairs.push({ from: item.currency, to: NET_WORTH_CURRENCY });
  await refreshFxRates(fxPairs);
  const rateMap = await getFxRateMap(fxPairs);

  // Build portfolio values
  const portfolioValues: PortfolioValue[] = portfolios.map((portfolio) => {
    let totalValue = 0;
    let unpricedCount = 0;
    const holdingValues: HoldingValue[] = portfolio.holdings.map((holding) => {
      const { units, cost } = holdingUnitsAndCost(holding.trades, portfolio.costMethod);
      const priceEntry = priceMap.get(holding.ticker);
      const currency = priceEntry?.currency ?? portfolio.currency;
      const valued = valueHolding({
        units,
        cost,
        price: priceEntry?.price,
        priceCurrency: currency,
        portfolioCurrency: portfolio.currency,
        rateMap,
      });
      totalValue += valued.portfolioValue ?? 0;
      if (valued.unpriced) unpricedCount++;
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
        gainLoss: valued.gainLoss,
        gainLossPct: valued.gainLossPct,
        changePct: valued.currentPrice != null ? (priceEntry?.changePct ?? null) : null,
        currency,
        costCurrency: portfolio.currency,
      };
    });

    return {
      portfolioId: portfolio.id,
      portfolioName: portfolio.name,
      totalValue,
      totalCost: holdingValues.reduce((s, h) => s + h.costBasis, 0),
      unpricedCount,
      holdings: holdingValues,
    };
  });

  // Each portfolio's total is in its own currency (as shown on its own
  // page); convert before summing across portfolios.
  const sharesValue = portfolioValues.reduce((s, p, i) => {
    const converted = convertAmount(p.totalValue, portfolios[i].currency, NET_WORTH_CURRENCY, rateMap);
    return s + (converted ?? 0);
  }, 0);

  // Property valuations
  const twelveMonthsAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  let propertyValue = 0;
  let propertyStale = false;

  for (const property of properties) {
    const latest = property.valuations[0];
    if (latest) {
      const converted = convertAmount(latest.value, latest.currency, NET_WORTH_CURRENCY, rateMap);
      propertyValue += converted ?? 0;
      if (latest.valuedAt < twelveMonthsAgo) propertyStale = true;
    } else {
      propertyStale = true;
    }
  }

  // Items (the Inventory module), at purchase price
  const inventoryValue = inventoryItems.reduce((s, i) => {
    if (i.purchasePrice == null) return s;
    const converted = convertAmount(i.purchasePrice, i.currency, NET_WORTH_CURRENCY, rateMap);
    return s + (converted ?? 0);
  }, 0);

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
    unpricedCount: portfolioValues.reduce((s, p) => s + p.unpricedCount, 0),
    portfolios: portfolioValues,
    propertyStale,
    currency: NET_WORTH_CURRENCY,
  };
}
