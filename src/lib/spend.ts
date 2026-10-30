import { monthlyEquivalent } from "@/lib/utils";
import { convertAmount } from "@/lib/fx";
import { shortMonthName } from "@/lib/dateParts";

// Start and end dates are calendar dates stored at UTC midnight, so the
// month buckets are UTC month starts too: a local-midnight bucket on a server
// east of UTC falls on the previous UTC day, and would miss a contract that
// starts on the 1st (#422).
const FAR_FUTURE = new Date(Date.UTC(9999, 0, 1));

export interface MonthBucket {
  month: string; // "Jan 2026"
  total: number;
}

export function buildMonthlyTimeline(
  contracts: {
    cost: number | null;
    currency: string;
    billingFrequency: string | null;
    startDate: Date | null;
    endDate: Date | null;
  }[],
  months: number,
  targetCurrency: string,
  rateMap: Map<string, number>,
  now: Date = new Date(),
): MonthBucket[] {
  const buckets: MonthBucket[] = [];

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const label = `${shortMonthName(d.getUTCMonth() + 1)} ${d.getUTCFullYear()}`;
    let total = 0;

    for (const c of contracts) {
      const start = c.startDate ?? new Date(0);
      const end = c.endDate ?? FAR_FUTURE;
      if (d >= start && d <= end) {
        const converted = c.cost != null ? convertAmount(c.cost, c.currency, targetCurrency, rateMap) : null;
        if (converted != null) total += monthlyEquivalent(converted, c.billingFrequency);
      }
    }

    buckets.push({ month: label, total });
  }

  return buckets;
}

export interface YearBucket {
  year: string; // "2025"
  total: number;
}

// Sums monthly-equivalent cost across every month of each calendar year, for
// the last N years — i.e. each bar is the year's total recurring spend, not
// a single month's rate.
export function buildYearlyTimeline(
  contracts: {
    cost: number | null;
    currency: string;
    billingFrequency: string | null;
    startDate: Date | null;
    endDate: Date | null;
  }[],
  years: number,
  targetCurrency: string,
  rateMap: Map<string, number>,
  now: Date = new Date(),
): YearBucket[] {
  const buckets: YearBucket[] = [];
  const currentYear = now.getUTCFullYear();

  for (let i = years - 1; i >= 0; i--) {
    const year = currentYear - i;
    let total = 0;

    for (let month = 0; month < 12; month++) {
      const d = new Date(Date.UTC(year, month, 1));
      for (const c of contracts) {
        const start = c.startDate ?? new Date(0);
        const end = c.endDate ?? FAR_FUTURE;
        if (d >= start && d <= end) {
          const converted = c.cost != null ? convertAmount(c.cost, c.currency, targetCurrency, rateMap) : null;
          if (converted != null) total += monthlyEquivalent(converted, c.billingFrequency);
        }
      }
    }

    buckets.push({ year: String(year), total });
  }

  return buckets;
}

export interface CategoryBucket {
  category: string;
  monthlyTotal: number;
}

// Current recurring spend broken down by category, sorted highest first.
export function buildCategoryBreakdown(
  contracts: { category: string; cost: number | null; currency: string; billingFrequency: string | null }[],
  targetCurrency: string,
  rateMap: Map<string, number>,
): CategoryBucket[] {
  const totals = new Map<string, number>();

  for (const c of contracts) {
    const converted = c.cost != null ? convertAmount(c.cost, c.currency, targetCurrency, rateMap) : null;
    if (converted == null) continue;
    const amount = monthlyEquivalent(converted, c.billingFrequency);
    if (amount <= 0) continue;
    totals.set(c.category, (totals.get(c.category) ?? 0) + amount);
  }

  return [...totals.entries()]
    .map(([category, monthlyTotal]) => ({ category, monthlyTotal }))
    .sort((a, b) => b.monthlyTotal - a.monthlyTotal);
}
