// Terms of a Contract (#353, GLOSSARY.md): one period with its own start
// date, end date and cost. The current Term lives on the Contract; earlier
// ones are ContractTerm rows. Pure helpers for the Renew form's pre-fill and
// the "vs prior term" cost change, shared by the server pages and tests.
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
 *
 * `rollForwardTo` (the household's today, for an auto-renewing Contract,
 * which carried on by itself) skips whole Terms until the guessed end date
 * is on or after that day, so a Contract several Terms late isn't renewed
 * into a Term that has already ended.
 */
export function nextTermDates(
  current: { startDate: DateInput; endDate: DateInput },
  options: { rollForwardTo?: CalendarDay } = {},
): TermDates {
  const end = calendarDayOf(current.endDate);
  if (!end) return { startDate: null, endDate: null };
  const nextStart = addDays(end, 1);
  const start = calendarDayOf(current.startDate);
  const months = !start || start > end ? DEFAULT_TERM_MONTHS : wholeMonthsBetween(start, nextStart);
  // The k-th Term after the current one (0 is the next), measured from the
  // same anchor so month-end clamping can't drift across Terms.
  const term = (k: number): TermDates =>
    months
      ? {
          startDate: addMonths(nextStart, months * k),
          endDate: addDays(addMonths(nextStart, months * (k + 1)), -1),
        }
      : (() => {
          const length = daysBetween(start ?? end, end);
          const termStart = addDays(nextStart, (length + 1) * k);
          return { startDate: termStart, endDate: addDays(termStart, length) };
        })();
  let k = 0;
  const target = options.rollForwardTo;
  // Bounded, in case of a nonsensical date far in the past.
  while (target && k < 10_000 && (term(k).endDate ?? target) < target) k += 1;
  return term(k);
}

/** A Document that could be the paperwork for the Term being kept. */
export interface TermDocumentCandidate {
  id: string;
  category: string | null;
  uploadedAt: Date;
}

// Policies and agreements are a Term's paperwork; receipts, invoices and
// photos usually aren't. Uncategorised Documents sit in between.
const PAPERWORK_CATEGORIES = new Set(["POLICY", "RENTAL_AGREEMENT"]);

function paperworkRank(category: string | null): number {
  if (category && PAPERWORK_CATEGORIES.has(category)) return 0;
  if (!category || category === "OTHER") return 1;
  return 2;
}

/**
 * The Renew form's default for "Paperwork for the term being kept": the
 * newest policy or agreement among `candidates` (live Documents no earlier
 * Term has), else the newest uncategorised one, else the newest of the rest.
 */
export function pickTermDocument(candidates: TermDocumentCandidate[]): string | null {
  const [best] = [...candidates].sort(
    (a, b) =>
      paperworkRank(a.category) - paperworkRank(b.category) || b.uploadedAt.getTime() - a.uploadedAt.getTime(),
  );
  return best?.id ?? null;
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

/** "+12% vs prior term", "−5% vs prior term" or "Same as prior term", to the nearest whole percent. */
export function formatTermCostChange(change: number): string {
  const percent = Math.round(change * 100);
  if (percent === 0) return "Same as prior term";
  // A real minus sign, so a drop reads as clearly as a rise.
  return `${percent > 0 ? "+" : "−"}${Math.abs(percent)}% vs prior term`;
}
