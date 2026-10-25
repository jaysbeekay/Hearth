// The Reminder schedule (ADR 0003, #387): the one place that decides, for a
// Due entry, which Reminder goes out on this check and when the next one
// will. The scheduler (scheduler.ts) asks it what to send; the Reminder
// health card and the household roll-up (health.ts) ask it what to show, so
// the two can't disagree (#381).
//
// Pure: no database, no clock. Entries come from the Due policy
// (duePolicy.ts), so day counts are already in the household's day, and
// `today` is the household's calendar day.
//
// The sent log is keyed by date: a row counts as sent for an entry only when
// it is a SENT row for the same field, channel, threshold AND Due entry
// date. Moving a date therefore resets its Reminders without any writer
// clearing anything (#382). Rows with no date are stale history.

import {
  addDays,
  dueEntries,
  type CalendarDay,
  type DueContext,
  type DueEntry,
  type DueRecord,
} from "@/lib/duePolicy";
import { parseThresholds } from "@/lib/notifications/thresholds";

export const REMINDER_CHANNELS = ["EMAIL", "NTFY", "WEBHOOK"] as const;
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];

/** One row of the sent log, as the schedule needs it. */
export interface SentLogRow {
  field: string;
  channel: ReminderChannel;
  thresholdDays: number;
  /** The Due entry date this row was sent for; null for stale history. */
  dueDate: CalendarDay | null;
  status: "SENT" | "FAILED";
}

export interface ChannelSchedule {
  /** The threshold to send a Reminder for on this check, or null for nothing to send. */
  sendNow: number | null;
  /**
   * The day the next Reminder goes out: `today` while `sendNow` is set (it
   * goes on the next check), else the next threshold's day. Null when no
   * Reminder is left for this entry. Never before `today`.
   */
  nextReminderOn: CalendarDay | null;
}

export type ReminderSchedule = Record<ReminderChannel, ChannelSchedule>;

/** Records that can have Reminders. Tenancy Reminders come with #388. */
export type ReminderRecord = Exclude<DueRecord, { kind: "tenancy" }>;

const NOTHING: ChannelSchedule = { sendNow: null, nextReminderOn: null };

function nothing(): ReminderSchedule {
  return { EMAIL: NOTHING, NTFY: NOTHING, WEBHOOK: NOTHING };
}

/**
 * A record's Reminder thresholds in days, ascending: its own whole-day list,
 * else the household default's — the same list the Due policy's due-soon
 * window is the largest of.
 */
export function reminderThresholds(reminderDaysBefore: string | null | undefined, defaultDays: string): number[] {
  const whole = (value: string | null | undefined) =>
    value?.trim() ? parseThresholds(value).filter(Number.isInteger) : [];
  const own = whole(reminderDaysBefore);
  return own.length > 0 ? own : whole(defaultDays);
}

/** Whether an entry's state can still carry Reminders: today or ahead, and not Ended, Lapsed or waiting on a new end date. */
function remindableState(entry: DueEntry): boolean {
  return entry.daysLeft >= 0 && (entry.state === "due-soon" || entry.state === "later");
}

/**
 * The Due entries of a record that get Reminders. A Contract gets them for
 * its notice deadline, and for its end date only when it doesn't
 * auto-renew; an auto-renewing Contract simply carries on, so its end date
 * never reminds. Cancelled Contracts have no entries at all. Nothing gets a
 * Reminder once its date has passed.
 */
export function reminderEntries(record: ReminderRecord, ctx: DueContext): DueEntry[] {
  return dueEntries(record, ctx).filter(
    (entry) =>
      remindableState(entry) &&
      !(record.kind === "contract" && record.renewalType === "AUTO_RENEW" && entry.field === "endDate"),
  );
}

/**
 * Per channel: what to send for `entry` on this check, and when the next
 * Reminder goes out.
 *
 * - Only the most urgent threshold crossed so far matters. If it hasn't been
 *   sent for this date, it goes now. So when several thresholds are crossed
 *   at once (a record added late, or the scheduler was down) one catch-up
 *   Reminder goes out, and the larger thresholds it passed over never send.
 * - Otherwise the next Reminder is due on the day the next threshold is
 *   crossed.
 * - A FAILED row doesn't count as sent, so it's retried on the next check.
 */
export function reminderSchedule(
  entry: DueEntry,
  thresholds: number[],
  sentLog: SentLogRow[],
  today: CalendarDay,
): ReminderSchedule {
  const schedule = nothing();
  if (!remindableState(entry) || thresholds.length === 0) return schedule;

  const crossed = thresholds.filter((t) => entry.daysLeft <= t);
  const current = crossed.length > 0 ? Math.min(...crossed) : null;

  for (const channel of REMINDER_CHANNELS) {
    const sent = new Set(
      sentLog
        .filter(
          (row) =>
            row.status === "SENT" &&
            row.channel === channel &&
            row.field === entry.field &&
            row.dueDate === entry.date,
        )
        .map((row) => row.thresholdDays),
    );
    if (current != null && !sent.has(current)) {
      schedule[channel] = { sendNow: current, nextReminderOn: today };
      continue;
    }
    const ahead = thresholds.filter((t) => t < entry.daysLeft && !sent.has(t));
    const next = ahead.length > 0 ? addDays(entry.date, -Math.max(...ahead)) : null;
    schedule[channel] = { sendNow: null, nextReminderOn: next != null && next > today ? next : null };
  }
  return schedule;
}

export interface ReminderPlanEntry {
  entry: DueEntry;
  schedule: ReminderSchedule;
}

export interface ReminderPlan {
  /** A record that Needs review holds its Reminders until it's confirmed. */
  held: boolean;
  thresholds: number[];
  /** Entries that get Reminders; empty while held. */
  entries: ReminderPlanEntry[];
}

/** The whole Reminder picture for one record: the scheduler and the health card both start here. */
export function reminderPlan(
  record: ReminderRecord & { extractionPending?: boolean },
  ctx: DueContext,
  sentLog: SentLogRow[],
): ReminderPlan {
  const thresholds = reminderThresholds(record.reminderDaysBefore, ctx.defaultReminderDays);
  const held = record.extractionPending === true;
  if (held) return { held, thresholds, entries: [] };
  return {
    held,
    thresholds,
    entries: reminderEntries(record, ctx).map((entry) => ({
      entry,
      schedule: reminderSchedule(entry, thresholds, sentLog, ctx.today),
    })),
  };
}

/** Whether a log row is about one of the record's current Reminder entries, rather than history for an earlier date. */
export function isCurrentLogRow(row: Pick<SentLogRow, "field" | "dueDate">, entries: DueEntry[]): boolean {
  return row.dueDate != null && entries.some((e) => e.field === row.field && e.date === row.dueDate);
}

/**
 * Keeps the failed log rows that are still about a record's current
 * Reminder entries. With a date-keyed log, a failure for an earlier date
 * (since moved, or passed) is history, not a live problem.
 */
export function currentFailedLogs<
  L extends { ownerType: string; ownerId: string; field: string; dueDate: Date | null },
>(
  logs: L[],
  records: { CONTRACT: Map<string, ReminderRecord>; PRODUCT: Map<string, ReminderRecord>; VEHICLE: Map<string, ReminderRecord> },
  ctx: DueContext,
): L[] {
  return logs.filter((log) => {
    const record = records[log.ownerType as keyof typeof records]?.get(log.ownerId);
    if (!record) return false;
    const dueDate = log.dueDate ? dateToDay(log.dueDate) : null;
    return isCurrentLogRow({ field: log.field, dueDate }, reminderEntries(record, ctx));
  });
}

/** A calendar day as the UTC-midnight Date that date columns store. */
export function dayToDate(day: CalendarDay): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** The calendar day a UTC-midnight date column holds. */
export function dateToDay(date: Date): CalendarDay {
  return date.toISOString().slice(0, 10);
}
