import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(...inputs);
}

export function formatDate(date: Date | string | null | undefined) {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-AU", { year: "numeric", month: "short", day: "numeric" });
}

export function formatCurrency(amount: number | null | undefined, currency: string) {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function daysUntil(date: Date | string | null | undefined): number | null {
  if (!date) return null;
  const target = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const startOfTarget = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
  const startOfNow = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((startOfTarget - startOfNow) / 86_400_000);
}

export function expiryLabel(days: number | null): string {
  if (days == null) return "No end date";
  if (days < 0) return `Expired ${Math.abs(days)}d ago`;
  if (days === 0) return "Expires today";
  return `${days}d left`;
}

export const CATEGORY_LABELS: Record<string, string> = {
  RENTAL: "Rental",
  CAR_INSURANCE: "Car Insurance",
  HOME_INSURANCE: "Home Insurance",
  STRATA_INSURANCE: "Strata Insurance",
  HEALTH_INSURANCE: "Health Insurance",
  LIFE_INSURANCE: "Life Insurance",
  UTILITY: "Utility",
  TELECOM: "Telecom",
  SUBSCRIPTION: "Subscription",
  LOAN: "Loan",
  WARRANTY: "Warranty",
  OTHER: "Other",
};

export const BILLING_LABELS: Record<string, string> = {
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  ANNUALLY: "Annually",
  ONE_OFF: "One-off",
};

export function humanFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

export function monthlyEquivalent(cost: number | null, frequency: string | null): number {
  if (cost == null || frequency == null) return 0;
  switch (frequency) {
    case "WEEKLY":
      return (cost * 52) / 12;
    case "MONTHLY":
      return cost;
    case "QUARTERLY":
      return cost / 3;
    case "ANNUALLY":
      return cost / 12;
    default:
      return 0;
  }
}

export const RENEWAL_LABELS: Record<string, string> = {
  AUTO_RENEW: "Auto-renews",
  MANUAL_RENEWAL: "Manual renewal",
  FIXED_TERM: "Fixed term (ends, no renewal)",
};

export const TRIP_SEGMENT_TYPE_LABELS: Record<string, string> = {
  FLIGHT: "Flight",
  LODGING: "Lodging",
  ACTIVITY: "Activity",
};

export const HOME_ITEM_TYPE_LABELS: Record<string, string> = {
  MAINTENANCE: "Maintenance",
  IMPROVEMENT: "Improvement",
  REPAIR: "Repair",
  OTHER: "Other",
};

export const VEHICLE_ITEM_TYPE_LABELS: Record<string, string> = {
  SERVICE: "Service",
  REPAIR: "Repair",
  REGISTRATION: "Registration",
  INSURANCE: "Insurance",
  ROADWORTHY: "Roadworthy",
  MODIFICATION: "Modification",
  OTHER: "Other",
};

// AU financial year runs 1 Jul–30 Jun; e.g. 15 Mar 2026 and 1 Aug 2025 are both "FY2025–26".
export function financialYearLabel(date: Date) {
  const startYear = date.getMonth() >= 6 ? date.getFullYear() : date.getFullYear() - 1;
  return `FY${startYear}–${String(startYear + 1).slice(-2)}`;
}

export interface YearTotal {
  label: string;
  amount: number;
  currency: string;
}

export function sumByYear(
  items: { cost: number | null; date: Date | null; currency: string }[],
  labelFor: (date: Date) => string,
): YearTotal[] {
  const totals = new Map<string, number>();
  for (const item of items) {
    if (item.cost == null || !item.date) continue;
    const key = `${labelFor(item.date)}|${item.currency}`;
    totals.set(key, (totals.get(key) ?? 0) + item.cost);
  }
  return [...totals.entries()]
    .map(([key, amount]) => {
      const [label, currency] = key.split("|");
      return { label, amount, currency };
    })
    .sort((a, b) => b.label.localeCompare(a.label));
}
