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

export interface MonthlySpend {
  /** The estimated monthly total, in the target currency. */
  total: number;
  /** Currencies with no exchange rate to the target right now, left out of `total`. */
  unconvertedCurrencies: string[];
}

/**
 * #394 — the "about $X a month" figure: every contract's cost converted to
 * the target currency and brought to a monthly amount. The dashboard, the
 * Spending page, MCP and the Assistant all use this, so they agree. A
 * contract whose currency can't be converted is left out and named, never
 * added unconverted.
 */
export function monthlySpend(
  contracts: { cost: number | null; currency: string; billingFrequency: string | null }[],
  targetCurrency: string,
  rateMap: Map<string, number>,
): MonthlySpend {
  const unconverted = new Set<string>();
  let total = 0;
  for (const c of contracts) {
    if (c.cost == null) continue;
    const converted = convertAmount(c.cost, c.currency, targetCurrency, rateMap);
    if (converted == null) {
      unconverted.add(c.currency);
      continue;
    }
    total += monthlyEquivalent(converted, c.billingFrequency);
  }
  return { total, unconvertedCurrencies: [...unconverted].sort() };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_DAYS = 365;

/**
 * #367 — what the household's contracts cost over the next 12 months if
 * nothing changes: an auto-renewing contract (or one with no end date) runs
 * all year; a fixed-term or manually renewed one only counts up to its end
 * date; one that hasn't started counts from its start date. Dates are
 * calendar days at UTC midnight (see the note at the top of this file).
 */
export function nextTwelveMonthsSpend(
  contracts: {
    cost: number | null;
    currency: string;
    billingFrequency: string | null;
    startDate: Date | null;
    endDate: Date | null;
    renewalType: string | null;
  }[],
  targetCurrency: string,
  rateMap: Map<string, number>,
  now: Date = new Date(),
): number {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const horizon = today + YEAR_DAYS * DAY_MS;
  let total = 0;
  for (const c of contracts) {
    if (c.cost == null) continue;
    const converted = convertAmount(c.cost, c.currency, targetCurrency, rateMap);
    if (converted == null) continue;
    const monthly = monthlyEquivalent(converted, c.billingFrequency);
    if (monthly <= 0) continue;
    const from = Math.max(today, c.startDate?.getTime() ?? today);
    const runsOn = c.renewalType === "AUTO_RENEW" || c.endDate == null;
    // The end date is the last day covered, so count through it.
    const to = runsOn ? horizon : Math.min(horizon, c.endDate!.getTime() + DAY_MS);
    if (to <= from) continue;
    total += monthly * 12 * ((to - from) / DAY_MS / YEAR_DAYS);
  }
  return total;
}

/** #367 — whether every bucket is the same, so the timeline shows no change. */
export function timelineIsFlat(buckets: { total: number }[]): boolean {
  return buckets.every((b) => Math.abs(b.total - buckets[0].total) < 0.005);
}
