// The Due policy (ADR 0002): the one place that decides, for any record,
// which dated obligations it has, how many days each has left, what state
// each is in and what its badge says. Lists, the dashboard, Needs
// attention, Search, Upcoming, iCal, banners, MCP, the Assistant and the
// Reminder schedule all ask this module instead of working it out
// themselves. A database query may narrow candidates roughly, but never
// decides Due on its own.
//
// Kept pure and dependency-light so it can run anywhere (server, client,
// vitest): `today` is always passed in as the household's calendar day, and
// this module never reads the clock. The standalone mobile shell keeps a
// hand-ported copy, held in step by tests/fixtures/due-policy-cases.json,
// which both test suites run — any rule change here changes that file.
//
// Input contract:
// - Date fields (end dates, rego expiry and so on) are calendar dates
//   stored at UTC midnight, so a date's calendar day is its UTC date. A
//   `Date`, a `YYYY-MM-DD` string, or a full ISO-8601 timestamp with `Z` or
//   an offset is accepted; a timestamp is reduced to its UTC date, so
//   "2026-10-25T00:00:00+11:00" is the 24th. Anything else (locale strings
//   like "10/24/2026", impossible dates like "2026-13-45") counts as no date.
// - `status` and `renewalType` are the Prisma enum values, matched exactly.
//   Only "CANCELLED" is cancelled; any other status is active. Only
//   "AUTO_RENEW" and "FIXED_TERM" are special; any other renewal type,
//   including lowercase spellings, is treated as MANUAL_RENEWAL.
// - Reminder thresholds and notice periods must be whole days; anything
//   else is unusable and ignored.

import { parseThresholds } from "@/lib/notifications/thresholds";

/** A calendar day as `YYYY-MM-DD`. */
export type CalendarDay = string;

type DateInput = Date | string | null | undefined;

export type DueState = "later" | "due-soon" | "overdue" | "ended" | "lapsed" | "needs-new-end-date";

export type VehicleDueField = "regoExpiry" | "insuranceExpiry" | "nextServiceDue";

export type DueField = "noticeDeadline" | "endDate" | "warrantyEndDate" | VehicleDueField | "leaseEnd";

export interface DueEntry {
  field: DueField;
  date: CalendarDay;
  /** Days from today to `date` in the household's day; negative once passed. */
  daysLeft: number;
  state: DueState;
  label: string;
}

export type DueRecord =
  | {
      kind: "contract";
      endDate: DateInput;
      noticePeriodDays: number | null;
      renewalType: string;
      status: string;
      reminderDaysBefore?: string | null;
    }
  | { kind: "warranty"; warrantyEndDate: DateInput; reminderDaysBefore?: string | null }
  | {
      kind: "vehicle";
      regoExpiry: DateInput;
      insuranceExpiry: DateInput;
      nextServiceDue: DateInput;
      reminderDaysBefore?: string | null;
      /**
       * Dates a linked Contract Covers instead (#373). Those fields return no
       * entry here, since the Contract's own entries stand in for them.
       */
      coveredFields?: VehicleDueField[];
    }
  | { kind: "tenancy"; leaseEnd: DateInput };

export interface DueContext {
  today: CalendarDay;
  /** The household default Reminder thresholds, as `getReminderConfig().defaultDays`. */
  defaultReminderDays: string;
}

const DAY_MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ─── Household day ────────────────────────────────────────────────────────────

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

/**
 * The server's own zone, used until an admin picks a household timezone:
 * `TZ` (a POSIX ":Area/City" loses its colon), else the zone Node is
 * actually running in, else UTC.
 */
export function serverTimeZone(envTz: string | null | undefined): string {
  return resolveTimeZone(envTz?.replace(/^:/, ""), Intl.DateTimeFormat().resolvedOptions().timeZone);
}

/**
 * The calendar day `now` falls on in `timeZone` — the household's "today".
 * An invalid zone counts as UTC; an invalid `now` throws, since there is no
 * sensible day to fall back to.
 */
export function householdDay(now: Date, timeZone: string): CalendarDay {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error(`householdDay needs a valid Date for "now", got ${String(now)}`);
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: resolveTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

// ─── Calendar-day arithmetic ──────────────────────────────────────────────────

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

// Milliseconds at UTC midnight of a calendar date. setUTCFullYear, unlike
// Date.UTC, doesn't read years 0–99 as 1900–1999.
function utcMidnight(y: number, m: number, d: number): number {
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d);
  return date.getTime();
}

function dayOf(ms: number): CalendarDay | null {
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  if (Number.isNaN(year) || year < 0 || year > 9999) return null;
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(year, 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function toDay(value: DateInput): CalendarDay | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return dayOf(value.getTime());
  if (DAY_PATTERN.test(value)) {
    // Reject impossible dates such as 2026-13-45, which would otherwise roll over.
    const [y, m, d] = value.split("-").map(Number);
    return dayOf(utcMidnight(y, m, d)) === value ? value : null;
  }
  if (TIMESTAMP_PATTERN.test(value)) return dayOf(new Date(value).getTime());
  return null;
}

function dayNumber(day: CalendarDay): number {
  const [y, m, d] = day.split("-").map(Number);
  return utcMidnight(y, m, d) / DAY_MS;
}

/** The calendar day `days` after `day` (before it, when negative). */
export function addDays(day: CalendarDay, days: number): CalendarDay {
  return dayOf((dayNumber(day) + days) * DAY_MS) ?? day;
}

/** Days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: CalendarDay, to: CalendarDay): number {
  return dayNumber(to) - dayNumber(from);
}

// ─── Labels ───────────────────────────────────────────────────────────────────

/** "3 Nov", or "3 Nov 2027" when it isn't this year. */
export function formatDueDate(day: CalendarDay, today: CalendarDay): string {
  const [, m, d] = day.split("-").map(Number);
  const short = `${d} ${MONTHS[m - 1]}`;
  return day.slice(0, 4) === today.slice(0, 4) ? short : `${short} ${day.slice(0, 4)}`;
}

function onDay(day: CalendarDay, today: CalendarDay): string {
  return day === today ? "today" : formatDueDate(day, today);
}

function ago(daysPast: number): string {
  return daysPast === 1 ? "yesterday" : `${daysPast} days ago`;
}

// ─── Rules ────────────────────────────────────────────────────────────────────

/** A notice deadline needs a positive, whole-day notice period on a Contract that can renew. */
export function noticeApplies(input: { noticePeriodDays: number | null; renewalType: string }): boolean {
  return (
    input.renewalType !== "FIXED_TERM" &&
    input.noticePeriodDays != null &&
    Number.isInteger(input.noticePeriodDays) &&
    input.noticePeriodDays > 0
  );
}

// Whole-day thresholds only; garbage, negative and fractional entries drop out.
function wholeDayThresholds(value: string | null | undefined): number[] {
  if (!value?.trim()) return [];
  return parseThresholds(value).filter(Number.isInteger);
}

/** How far ahead a record becomes Due: its largest Reminder threshold, else the household default's. */
export function dueSoonWindow(reminderDaysBefore: string | null | undefined, defaultReminderDays: string): number {
  const own = wholeDayThresholds(reminderDaysBefore);
  const days = own.length > 0 ? own : wholeDayThresholds(defaultReminderDays);
  return days.length > 0 ? Math.max(...days) : 0;
}

/** Whether an entry belongs in Needs attention's Due list. */
export function isDue(entry: DueEntry): boolean {
  return entry.state === "due-soon" || entry.state === "overdue";
}

// An entry that's today or ahead: due soon inside the window, later outside it.
function upcoming(field: DueField, date: CalendarDay, daysLeft: number, window: number, label: string): DueEntry {
  return { field, date, daysLeft, state: daysLeft <= window ? "due-soon" : "later", label };
}

function contractEntries(record: Extract<DueRecord, { kind: "contract" }>, ctx: DueContext): DueEntry[] {
  // Enum values match exactly: see the input contract at the top.
  if (record.status === "CANCELLED") return [];
  const end = toDay(record.endDate);
  if (!end) return [];
  const { today } = ctx;
  const window = dueSoonWindow(record.reminderDaysBefore, ctx.defaultReminderDays);

  // The notice deadline while it's today or still ahead, then the end date.
  if (noticeApplies(record)) {
    const deadline = addDays(end, -record.noticePeriodDays!);
    const days = daysBetween(today, deadline);
    if (days >= 0) return [upcoming("noticeDeadline", deadline, days, window, `Cancel by ${onDay(deadline, today)}`)];
  }

  const daysLeft = daysBetween(today, end);
  if (daysLeft >= 0) {
    // An auto-renewing Contract simply carries on, so its end date is never
    // Due: only its notice deadline is.
    if (record.renewalType === "AUTO_RENEW") {
      return [{ field: "endDate", date: end, daysLeft, state: "later", label: `Renews ${onDay(end, today)}` }];
    }
    const verb = record.renewalType === "FIXED_TERM" ? "Ends" : "Expires";
    return [upcoming("endDate", end, daysLeft, window, `${verb} ${onDay(end, today)}`)];
  }

  const past = -daysLeft;
  switch (record.renewalType) {
    case "FIXED_TERM":
      return [{ field: "endDate", date: end, daysLeft, state: "ended", label: `Ended ${formatDueDate(end, today)}` }];
    case "AUTO_RENEW":
      // It carried on into its next Term: Housekeeping, not Due.
      return [{ field: "endDate", date: end, daysLeft, state: "needs-new-end-date", label: "Needs new end date" }];
    default:
      return [{ field: "endDate", date: end, daysLeft, state: "overdue", label: `Expired ${ago(past)}` }];
  }
}

function warrantyEntries(record: Extract<DueRecord, { kind: "warranty" }>, ctx: DueContext): DueEntry[] {
  const end = toDay(record.warrantyEndDate);
  if (!end) return [];
  const daysLeft = daysBetween(ctx.today, end);
  if (daysLeft < 0) {
    return [{ field: "warrantyEndDate", date: end, daysLeft, state: "lapsed", label: `Lapsed ${formatDueDate(end, ctx.today)}` }];
  }
  const window = dueSoonWindow(record.reminderDaysBefore, ctx.defaultReminderDays);
  return [upcoming("warrantyEndDate", end, daysLeft, window, `Ends ${onDay(end, ctx.today)}`)];
}

const VEHICLE_FIELDS: { field: VehicleDueField; name: string; passed: (days: number) => string }[] = [
  { field: "regoExpiry", name: "Rego", passed: (days) => `Rego expired ${ago(days)}` },
  { field: "insuranceExpiry", name: "Insurance", passed: (days) => `Insurance expired ${ago(days)}` },
  { field: "nextServiceDue", name: "Service", passed: (days) => `Service overdue by ${days} ${days === 1 ? "day" : "days"}` },
];

function vehicleEntries(record: Extract<DueRecord, { kind: "vehicle" }>, ctx: DueContext): DueEntry[] {
  const window = dueSoonWindow(record.reminderDaysBefore, ctx.defaultReminderDays);
  const entries: DueEntry[] = [];
  for (const { field, name, passed } of VEHICLE_FIELDS) {
    if (record.coveredFields?.includes(field)) continue;
    const date = toDay(record[field]);
    if (!date) continue;
    const daysLeft = daysBetween(ctx.today, date);
    entries.push(
      daysLeft < 0
        ? { field, date, daysLeft, state: "overdue", label: passed(-daysLeft) }
        : upcoming(field, date, daysLeft, window, `${name} due ${onDay(date, ctx.today)}`),
    );
  }
  return entries;
}

function tenancyEntries(record: Extract<DueRecord, { kind: "tenancy" }>, ctx: DueContext): DueEntry[] {
  const end = toDay(record.leaseEnd);
  if (!end) return [];
  const daysLeft = daysBetween(ctx.today, end);
  if (daysLeft < 0) {
    // Like an auto-renewing Contract, it needs its new date: Housekeeping, not Due.
    return [
      { field: "leaseEnd", date: end, daysLeft, state: "needs-new-end-date", label: "Lease ended — set the new lease end" },
    ];
  }
  // A Tenancy has no Reminder thresholds of its own, so the household default sets its window.
  const window = dueSoonWindow(null, ctx.defaultReminderDays);
  return [upcoming("leaseEnd", end, daysLeft, window, `Lease ends ${onDay(end, ctx.today)}`)];
}

/** Every Due entry of a record, soonest first. Trips are never Due, so they aren't a record kind here. */
export function dueEntries(record: DueRecord, ctx: DueContext): DueEntry[] {
  const entries = (() => {
    switch (record.kind) {
      case "contract":
        return contractEntries(record, ctx);
      case "warranty":
        return warrantyEntries(record, ctx);
      case "vehicle":
        return vehicleEntries(record, ctx);
      case "tenancy":
        return tenancyEntries(record, ctx);
    }
  })();
  return entries.sort((a, b) => a.daysLeft - b.daysLeft);
}
