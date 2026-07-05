import { prisma } from "@/lib/prisma";
import { getPriceMap } from "@/lib/prices";
import type { ModuleKey } from "@/lib/modules/registry";

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

function holdingUnitsAndCost(trades: { type: string; units: number; pricePerUnit: number; fees: number | null }[]) {
  let units = 0;
  let cost = 0;
  for (const t of trades) {
    if (t.type === "BUY") {
      units += t.units;
      cost += t.units * t.pricePerUnit + (t.fees ?? 0);
    } else if (t.type === "SELL") {
      // reduce units; average cost basis reduces proportionally
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

export async function getNetWorth(
  userId: string,
  enabledModules: Set<ModuleKey>,
): Promise<NetWorthData> {
  const [portfolios, properties, inventoryItems] = await Promise.all([
    prisma.portfolio.findMany({
      where: { createdById: userId },
      include: {
        holdings: {
          include: { trades: { orderBy: { date: "asc" } } },
        },
      },
    }),
    enabledModules.has("HOME")
      ? prisma.property.findMany({
          where: { createdById: userId },
          include: { valuations: { orderBy: { valuedAt: "desc" }, take: 1 } },
        })
      : [],
    enabledModules.has("INVENTORY")
      ? prisma.inventoryItem.findMany({
          where: { createdById: userId },
          select: { purchasePrice: true },
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
      const { units, cost } = holdingUnitsAndCost(holding.trades);
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

  const sharesValue = portfolioValues.reduce((s, p) => s + p.totalValue, 0);

  // Property valuations
  const twelveMonthsAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  let propertyValue = 0;
  let propertyStale = false;

  for (const property of properties) {
    const latest = property.valuations[0];
    if (latest) {
      propertyValue += latest.value;
      if (latest.valuedAt < twelveMonthsAgo) propertyStale = true;
    } else {
      propertyStale = true;
    }
  }

  // Inventory value
  const inventoryValue = inventoryItems.reduce((s, i) => s + (i.purchasePrice ?? 0), 0);

  return {
    sharesValue,
    propertyValue,
    inventoryValue,
    totalNetWorth: sharesValue + propertyValue + inventoryValue,
    portfolios: portfolioValues,
    propertyStale,
    currency: "AUD",
  };
}
