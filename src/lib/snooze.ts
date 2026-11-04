// #354 — Snooze: "I know, remind me later" for a Due Contract, Warranty or
// Vehicle. A Snoozed record leaves Needs attention and gets no Reminders
// until its Snooze ends, then comes back on its own.
//
// A Snooze is tied to the dates it was set against (`snoozedFor`, a key of
// the record's due-relevant dates), the same way the Reminder log is keyed by
// date (ADR 0003): renewing the record or editing one of those dates ends it,
// with no writer having to remember to clear it.
//
// Pure, so the scheduler, health card, lists and client components agree.

import { calendarDayOf, type CalendarDay, type DateInput, type DueRecord } from "@/lib/duePolicy";

export type SnoozeKind = "contract" | "warranty" | "vehicle";

export interface SnoozeFields {
  snoozedUntil?: DateInput;
  snoozedFor?: string | null;
}

/** How long a Snooze can run at most. */
export const MAX_SNOOZE_DAYS = 366;

/** The preset lengths offered beside "until a date". */
export const SNOOZE_PRESETS = [
  { days: 7, label: "1 week" },
  { days: 30, label: "30 days" },
] as const;

type SnoozableRecord = Extract<DueRecord, { kind: SnoozeKind }>;

/** The due-relevant dates a Snooze is set against: change any of them and the Snooze ends. */
export function snoozeKey(record: SnoozableRecord): string {
  const day = (value: DateInput) => calendarDayOf(value) ?? "";
  switch (record.kind) {
    case "contract":
      return `contract:${day(record.endDate)}:${record.noticePeriodDays ?? ""}`;
    case "warranty":
      return `warranty:${day(record.warrantyEndDate)}`;
    case "vehicle":
      return `vehicle:${day(record.regoExpiry)}:${day(record.insuranceExpiry)}:${day(record.nextServiceDue)}`;
  }
}

/**
 * The last day of the record's Snooze while one is running, else null. A
 * Snooze runs to the end of the day before `snoozedUntil`: on that day the
 * record is back.
 */
export function activeSnoozeUntil(record: DueRecord & SnoozeFields, today: CalendarDay): CalendarDay | null {
  if (record.kind === "tenancy") return null;
  const until = calendarDayOf(record.snoozedUntil);
  if (!until || !record.snoozedFor) return null;
  if (until <= today) return null;
  if (record.snoozedFor !== snoozeKey(record)) return null;
  return until;
}
