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
