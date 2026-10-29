import { clsx, type ClassValue } from "clsx";
import { isValidTimeZone, isoDay, shortMonthName, zonedDayParts, type DayParts } from "@/lib/dateParts";
import { followsHouseholdTimeZone } from "@/lib/timezones";

export function cn(...inputs: ClassValue[]) {
  return clsx(...inputs);
}

export const DATE_FORMAT_OPTIONS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"] as const;
export type DateFormat = (typeof DATE_FORMAT_OPTIONS)[number];

export const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  "DD/MM/YYYY": "DD/MM/YYYY (e.g. 10 Jul 2026)",
  "MM/DD/YYYY": "MM/DD/YYYY (e.g. Jul 10, 2026)",
  "YYYY-MM-DD": "YYYY-MM-DD (e.g. 2026-07-10)",
};

// Locale tags used purely for number-formatting conventions (decimal/thousands
// separators, currency symbol placement) — not a language switch. Date/month
// names elsewhere in the app stay in English regardless of region; only
// DATE_FORMAT_OPTIONS above controls date field order.
export const REGION_OPTIONS = [
  "en-AU",
  "en-US",
  "en-GB",
  "en-CA",
  "en-NZ",
  "en-IN",
  "de-DE",
  "fr-FR",
  "es-ES",
  "it-IT",
  "pt-BR",
  "nl-NL",
  "sv-SE",
  "ja-JP",
  "zh-CN",
] as const;
export type Region = (typeof REGION_OPTIONS)[number];
export const DEFAULT_REGION: Region = "en-AU";

export const REGION_LABELS: Record<Region, string> = {
  "en-AU": "Australia (1,234.56)",
  "en-US": "United States (1,234.56)",
  "en-GB": "United Kingdom (1,234.56)",
  "en-CA": "Canada (1,234.56)",
  "en-NZ": "New Zealand (1,234.56)",
  "en-IN": "India (1,23,456.78)",
  "de-DE": "Germany (1.234,56)",
  "fr-FR": "France (1 234,56)",
  "es-ES": "Spain (1.234,56)",
  "it-IT": "Italy (1.234,56)",
  "pt-BR": "Brazil (1.234,56)",
  "nl-NL": "Netherlands (1.234,56)",
  "sv-SE": "Sweden (1 234,56)",
  "ja-JP": "Japan (1,234.56)",
  "zh-CN": "China (1,234.56)",
};

function toValidDate(date: Date | string): Date | null {
  const d = typeof date === "string" ? new Date(date) : date;
  return Number.isNaN(d.getTime()) ? null : d;
}

// A day in the user's format. Built from its numeric parts and English
// month names rather than toLocaleDateString, so the output never depends on
// the runtime's locale data ("Sep", never ICU's "Sept"), and matches the Due
// labels' dates exactly.
function formatDayParts(parts: DayParts, dateFormat: string | null | undefined): string {
  const month = shortMonthName(parts.month);
  switch (dateFormat) {
    case "MM/DD/YYYY":
      return `${month} ${parts.day}, ${parts.year}`;
    case "YYYY-MM-DD":
      return isoDay(parts);
    default:
      return `${parts.day} ${month} ${parts.year}`;
  }
}

/**
 * A calendar date (an end date, expiry, purchase date and so on) in the
 * user's date format. Calendar dates are stored at UTC midnight (the Due
 * policy's input contract), so this reads them in UTC: a stored 1 Dec shows
 * as 1 Dec whatever the server's or browser's timezone (#422). For a moment
 * in time, such as when a document was uploaded, use `formatTimestamp`.
 */
export function formatDate(
  date: Date | string | null | undefined,
  dateFormat?: string | null,
) {
  if (!date) return "—";
  const d = toValidDate(date);
  if (!d) return "—";
  if (dateFormat === "YYYY-MM-DD") return d.toISOString().slice(0, 10);
  return formatDayParts({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }, dateFormat);
}

/**
 * The day a moment in time (uploadedAt, sentAt, createdAt...) fell on in
 * `timeZone`, the viewer's display timezone, in the user's date format. An
 * invalid or missing zone counts as UTC, so the server and the browser
 * always agree.
 */
export function formatTimestamp(
  date: Date | string | null | undefined,
  dateFormat?: string | null,
  timeZone?: string | null,
) {
  if (!date) return "—";
  const d = toValidDate(date);
  if (!d) return "—";
  return formatDayParts(zonedDayParts(d, isValidTimeZone(timeZone) ? timeZone : "UTC"), dateFormat);
}

/**
 * The timezone a viewer's timestamps display in: their own Preferences
 * timezone once they've picked one, else the household's (which in turn
 * defaults to the server's). An empty or legacy "UTC" stored value means
 * they haven't picked one; a deliberate UTC choice is "Etc/UTC"
 * (timezones.ts).
 */
export function displayTimeZone(userTimeZone: string | null | undefined, householdTimeZone: string): string {
  return isValidTimeZone(userTimeZone) && !followsHouseholdTimeZone(userTimeZone) ? userTimeZone : householdTimeZone;
}

export interface CurrencyFormatOptions {
  /**
   * Render the ISO code ("AUD 1,234.50") instead of the locale's symbol.
   *
   * Intl already spells out non-local currencies — in en-AU, USD renders as
   * "USD 1,234.50" — but the household's *own* currency collapses to a bare
   * "$", which says nothing about which dollar it is (#174). Set this on any
   * view that can show more than one currency at once, so amounts there are
   * never ambiguous.
   */
  showCode?: boolean;
}

export function formatCurrency(
  amount: number | null | undefined,
  currency: string,
  fractionDigits?: number,
  region: string = DEFAULT_REGION,
  { showCode = false }: CurrencyFormatOptions = {},
) {
  if (amount == null) return "—";
  try {
    const opts: Intl.NumberFormatOptions = { style: "currency", currency };
    if (showCode) opts.currencyDisplay = "code";
    if (fractionDigits !== undefined) {
      opts.minimumFractionDigits = fractionDigits;
      opts.maximumFractionDigits = fractionDigits;
    }
    return new Intl.NumberFormat(region, opts).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(fractionDigits ?? 2)}`;
  }
}

export function formatNumber(value: number, region: string = DEFAULT_REGION, maximumFractionDigits = 6) {
  return value.toLocaleString(region, { maximumFractionDigits });
}

const KM_TO_MILES = 0.621371;

// #13 — shown in both units rather than gated behind a new unit-preference
// setting: distance is a small, infrequent display (one flight segment
// detail, one travel-page summary), not worth a household-wide toggle for.
export function formatDistance(km: number, region: string = DEFAULT_REGION): string {
  const miles = km * KM_TO_MILES;
  return `${Math.round(km).toLocaleString(region)} km / ${Math.round(miles).toLocaleString(region)} mi`;
}

/**
 * Server-local day count. Only the MCP server and the Assistant still use
 * it, until #394 moves them onto the Due policy; every screen asks the
 * policy (duePolicy.ts, ADR 0002), which counts in the household's day.
 */
export function daysUntil(date: Date | string | null | undefined): number | null {
  if (!date) return null;
  const target = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const startOfTarget = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
  const startOfNow = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((startOfTarget - startOfNow) / 86_400_000);
}

export const CATEGORY_LABELS: Record<string, string> = {
  RENTAL: "Rental",
  CAR_INSURANCE: "Car insurance",
  HOME_INSURANCE: "Home insurance",
  STRATA_INSURANCE: "Strata insurance (body corporate / HOA)",
  HEALTH_INSURANCE: "Health insurance",
  LIFE_INSURANCE: "Life insurance",
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

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  MEMBER: "Member",
  READONLY: "Read-only",
};

// #291 — shown next to the role select at assignment time so "Member" vs
// "Admin" vs "Read-only" isn't left for the admin to infer.
export const ROLE_DESCRIPTIONS: Record<string, string> = {
  READONLY: "Can see shared household records, but can't change or delete them.",
  MEMBER: "Can add, edit, and move shared household records to Trash.",
  ADMIN: "Can also manage household members, modules, backups, and system settings.",
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
  ROADWORTHY: "Roadworthy",
  MODIFICATION: "Modification",
  PURCHASE: "Purchase",
  OTHER: "Other",
};

export const OCCUPANCY_STATUS_LABELS: Record<string, string> = {
  OWNER_OCCUPIED: "Owner-occupied",
  RENTED: "Rented",
  VACANT: "Vacant",
  OTHER: "Other",
};

interface PropertyAddressParts {
  street?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
  country?: string | null;
}

// Composes the structured address fields into a single display string, e.g.
// "123 Main St, Richmond VIC 3121, Australia".
export function formatPropertyAddress(property: PropertyAddressParts): string {
  const line2 = [property.suburb, property.state, property.postcode].filter(Boolean).join(" ");
  return [property.street, line2, property.country].filter(Boolean).join(", ");
}

// AU financial year runs 1 Jul–30 Jun; e.g. 15 Mar 2026 and 1 Aug 2025 are both "FY2025–26".
export function financialYearLabel(date: Date) {
  // A calendar date stored at UTC midnight, so read in UTC: locally, 1 Jul
  // on a server west of UTC is still 30 Jun, the previous financial year (#422).
  const startYear = date.getUTCMonth() >= 6 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
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
