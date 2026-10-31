// #422 — the few date building blocks shared by the Due policy and utils'
// date formatters, kept in a tiny dependency-free module so client bundles
// that format a date don't pull in the whole Due policy. Output never
// depends on the runtime's ICU locale data: month names are hard-coded, and
// Intl is only asked for numeric parts in a timezone.

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** The month's English name, 1-based ("November" for 11); "" outside 1–12. */
export function longMonthName(month: number): string {
  // Bounds-checked: .at() would count a 0 or negative month from the end.
  return Number.isInteger(month) && month >= 1 && month <= 12 ? (MONTHS.at(month - 1) ?? "") : "";
}

/** The month's short English name, 1-based ("Nov" for 11); "" outside 1–12. */
export function shortMonthName(month: number): string {
  return longMonthName(month).slice(0, 3);
}

export function isValidTimeZone(timeZone: string | null | undefined): timeZone is string {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The first valid IANA zone among the candidates, else UTC. */
export function resolveTimeZone(...candidates: (string | null | undefined)[]): string {
  return candidates.find(isValidTimeZone) ?? "UTC";
}

export interface DayParts {
  year: number;
  /** 1–12. */
  month: number;
  day: number;
}

/** The calendar day `date` falls on in `timeZone` (an invalid zone counts as UTC). */
export function zonedDayParts(date: Date, timeZone: string): DayParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: resolveTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day") };
}

/** `YYYY-MM-DD` for a day's parts. */
export function isoDay({ year, month, day }: DayParts): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}
