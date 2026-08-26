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
  gainLoss: number | null;
  gainLossPct: number | null;
  changePct: number | null;
  currency: string;
}

export interface PortfolioValue {
  portfolioId: string;
  portfolioName: string;
  totalValue: number;
  totalCost: number;
  holdings: HoldingValue[];
}

export interface NetWorthData {
  sharesValue: number;
  propertyValue: number;
  inventoryValue: number;
  totalNetWorth: number;
  portfolios: PortfolioValue[];
  propertyStale: boolean; // any property has no valuation in last 12 months
  currency: string;
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
          include: { valuations: { orderBy: { valuedAt: "desc" }, take: 1 } },
        })
      : [],
    enabledModules.has("INVENTORY")
      ? prisma.inventoryItem.findMany({
          select: { purchasePrice: true, currency: true },
        })
      : [],
  ]);

  // Collect all tickers for price lookup
  const allTickers = portfolios.flatMap((p) =>
    p.holdings.map((h) => ({ ticker: h.ticker, exchange: h.exchange })),
  );
  const uniqueTickers = [...new Map(allTickers.map((t) => [t.ticker, t])).values()];
  const priceMap = await getPriceMap(uniqueTickers.map((t) => t.ticker));

  // Build portfolio values
  const portfolioValues: PortfolioValue[] = portfolios.map((portfolio) => {
    const holdingValues: HoldingValue[] = portfolio.holdings.map((holding) => {
      const { units, cost } = holdingUnitsAndCost(holding.trades, portfolio.costMethod);
      const priceEntry = priceMap.get(holding.ticker);
      const currentPrice = priceEntry?.price ?? null;
      const currency = priceEntry?.currency ?? portfolio.currency;
      const currentValue = currentPrice != null && units > 0 ? units * currentPrice : null;
      const gainLoss = currentValue != null ? currentValue - cost : null;
      const gainLossPct = gainLoss != null && cost > 0 ? (gainLoss / cost) * 100 : null;
      return {
        holdingId: holding.id,
        ticker: holding.ticker,
        name: holding.name,
        exchange: holding.exchange,
        assetClass: holding.assetClass,
        unitsHeld: units,
        costBasis: cost,
        currentPrice,
        currentValue,
        gainLoss,
        gainLossPct,
        changePct: priceEntry?.changePct ?? null,
        currency,
      };
    });

    const totalValue = holdingValues.reduce((s, h) => s + (h.currentValue ?? 0), 0);
    const totalCost = holdingValues.reduce((s, h) => s + h.costBasis, 0);

    return {
      portfolioId: portfolio.id,
      portfolioName: portfolio.name,
      totalValue,
      totalCost,
      holdings: holdingValues,
    };
  });

  // Convert each portfolio's total value (denominated in its own currency, as
  // already shown on its own page) to a common currency before summing across
  // portfolios — summing raw numbers across different portfolio currencies
  // would produce a meaningless total. Same for property valuations and
  // inventory purchase prices, which each carry their own currency field.
  const portfolioCurrencies = portfolios.map((p) => p.currency);
  const propertyCurrencies = properties
    .map((p) => p.valuations[0]?.currency)
    .filter((c): c is string => !!c);
  const inventoryCurrencies = inventoryItems.map((i) => i.currency);
  const allCurrencies = [
    ...new Set([...portfolioCurrencies, ...propertyCurrencies, ...inventoryCurrencies]),
  ];
  const fxPairs = allCurrencies.map((from) => ({ from, to: NET_WORTH_CURRENCY }));
  await refreshFxRates(fxPairs);
  const rateMap = await getFxRateMap(fxPairs);

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

  // Inventory value
  const inventoryValue = inventoryItems.reduce((s, i) => {
    if (i.purchasePrice == null) return s;
    const converted = convertAmount(i.purchasePrice, i.currency, NET_WORTH_CURRENCY, rateMap);
    return s + (converted ?? 0);
  }, 0);

  return {
    sharesValue,
    propertyValue,
    inventoryValue,
    totalNetWorth: sharesValue + propertyValue + inventoryValue,
    portfolios: portfolioValues,
    propertyStale,
    currency: NET_WORTH_CURRENCY,
  };
}
