// Terms of a Contract (#353, GLOSSARY.md): one period with its own start
// date, end date and cost. The current Term lives on the Contract; earlier
// ones are ContractTerm rows. Pure helpers for the Renew form's pre-fill and
// the "vs last term" cost change, shared by the server pages and tests.
// The standalone shell (ios-shell/www/app.js) keeps a hand-ported copy.

import { addDays, calendarDayOf, daysBetween, type CalendarDay, type DateInput } from "@/lib/duePolicy";
import { BILLING_LABELS, formatCurrency } from "@/lib/utils";

/** A Term's length when the current one has no start date to measure from. */
const DEFAULT_TERM_MONTHS = 12;

function parts(day: CalendarDay): [number, number, number] {
  const [y, m, d] = day.split("-").map(Number);
  return [y, m, d];
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** `day` moved by whole months, clamped to the end of a shorter month (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(day: CalendarDay, months: number): CalendarDay {
  const [y, m, d] = parts(day);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(Math.min(d, lastDay))}`;
}

/** Whole months from `from` to `to` when `to` falls on the same day of the month, else null. */
function wholeMonthsBetween(from: CalendarDay, to: CalendarDay): number | null {
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(to);
  if (fd !== td) return null;
  const months = (ty - fy) * 12 + (tm - fm);
  return months > 0 ? months : null;
}

export interface TermDates {
  startDate: CalendarDay | null;
  endDate: CalendarDay | null;
}

/**
 * The Renew form's guess at the next Term: it starts the day after the
 * current end date and lasts as long as the current Term. A Term measured in
 * whole months (1 Jul – 30 Jun) stays in whole months, so leap years don't
 * shift it by a day; any other length is kept in days. With no start date
 * to measure from, a year is assumed. With no end date there's nothing to
 * continue from, so nothing is guessed.
 */
export function nextTermDates(current: { startDate: DateInput; endDate: DateInput }): TermDates {
  const end = calendarDayOf(current.endDate);
  if (!end) return { startDate: null, endDate: null };
  const nextStart = addDays(end, 1);
  const start = calendarDayOf(current.startDate);
  if (!start || start > end) {
    return { startDate: nextStart, endDate: addDays(addMonths(nextStart, DEFAULT_TERM_MONTHS), -1) };
  }
  const months = wholeMonthsBetween(start, nextStart);
  if (months) return { startDate: nextStart, endDate: addDays(addMonths(nextStart, months), -1) };
  return { startDate: nextStart, endDate: addDays(nextStart, daysBetween(start, end)) };
}

export interface TermCost {
  cost: number | null;
  currency: string;
  billingFrequency: string | null;
}

/**
 * How much `current` costs compared with `previous`, as a fraction (0.12 is
 * 12% more), or null when the two can't be compared: a cost is missing, the
 * earlier one was nothing, or they're in different currencies or billed
 * differently (a monthly price against an annual one says nothing).
 */
export function termCostChange(current: TermCost, previous: TermCost | null | undefined): number | null {
  if (!previous) return null;
  if (current.cost == null || previous.cost == null || previous.cost <= 0) return null;
  if (current.currency !== previous.currency) return null;
  if ((current.billingFrequency ?? null) !== (previous.billingFrequency ?? null)) return null;
  return (current.cost - previous.cost) / previous.cost;
}

const BILLING = new Map(Object.entries(BILLING_LABELS));

/** A billing frequency in lower case for running text ("annually"), or null when there isn't one. */
export function billingFrequencyText(billingFrequency: string | null | undefined): string | null {
  if (!billingFrequency) return null;
  return BILLING.get(billingFrequency)?.toLowerCase() ?? null;
}

/** A Term's cost as "$1,200.00 / annually", or "—" with no cost. */
export function formatTermCost(term: TermCost, region?: string): string {
  if (term.cost == null) return "—";
  const frequency = billingFrequencyText(term.billingFrequency);
  return `${formatCurrency(term.cost, term.currency, undefined, region)}${frequency ? ` / ${frequency}` : ""}`;
}

/** "+12% vs last term", "−5% vs last term" or "Same as last term", to the nearest whole percent. */
export function formatTermCostChange(change: number, versus = "last term"): string {
  const percent = Math.round(change * 100);
  if (percent === 0) return `Same as ${versus}`;
  // A real minus sign, so a drop reads as clearly as a rise.
  return `${percent > 0 ? "+" : "−"}${Math.abs(percent)}% vs ${versus}`;
}
