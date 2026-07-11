import { monthlyEquivalent } from "@/lib/utils";
import { format } from "date-fns";

export interface MonthBucket {
  month: string; // "Jan 2026"
  total: number;
}

export function buildMonthlyTimeline(
  contracts: {
    cost: number | null;
    billingFrequency: string | null;
    startDate: Date | null;
    endDate: Date | null;
  }[],
  months: number,
): MonthBucket[] {
  const buckets: MonthBucket[] = [];
  const now = new Date();

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = format(d, "MMM yyyy");
    let total = 0;

    for (const c of contracts) {
      const start = c.startDate ?? new Date(0);
      const end = c.endDate ?? new Date(9999, 0);
      if (d >= start && d <= end) {
        total += monthlyEquivalent(c.cost, c.billingFrequency);
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
    billingFrequency: string | null;
    startDate: Date | null;
    endDate: Date | null;
  }[],
  years: number,
): YearBucket[] {
  const buckets: YearBucket[] = [];
  const currentYear = new Date().getFullYear();

  for (let i = years - 1; i >= 0; i--) {
    const year = currentYear - i;
    let total = 0;

    for (let month = 0; month < 12; month++) {
      const d = new Date(year, month, 1);
      for (const c of contracts) {
        const start = c.startDate ?? new Date(0);
        const end = c.endDate ?? new Date(9999, 0);
        if (d >= start && d <= end) {
          total += monthlyEquivalent(c.cost, c.billingFrequency);
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
  contracts: { category: string; cost: number | null; billingFrequency: string | null }[],
): CategoryBucket[] {
  const totals = new Map<string, number>();

  for (const c of contracts) {
    const amount = monthlyEquivalent(c.cost, c.billingFrequency);
    if (amount <= 0) continue;
    totals.set(c.category, (totals.get(c.category) ?? 0) + amount);
  }

  return [...totals.entries()]
    .map(([category, monthlyTotal]) => ({ category, monthlyTotal }))
    .sort((a, b) => b.monthlyTotal - a.monthlyTotal);
}
