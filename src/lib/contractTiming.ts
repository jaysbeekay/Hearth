// #351 — a contract's notice period moves the date that matters. With a
// 30-day notice period, the last day to act is 30 days before the end date;
// counting down to the end date means every reminder lands after the chance
// to cancel has gone. This is the one place that works out which date to
// count to, so the badge, banner, lists, dashboard, Needs attention,
// calendar and reminders all agree.
//
// A fixed-term contract simply ends, so there is nothing to give notice of:
// its notice period (if any) is ignored.

export interface ContractTimingInput {
  endDate: Date | string | null;
  noticePeriodDays: number | null;
  renewalType: string;
}

export interface ContractTiming {
  /** Days until the end date (negative once it has passed). */
  endDays: number | null;
  /** Last day to give notice, when a notice period applies. */
  cancelBy: Date | null;
  cancelByDays: number | null;
  /**
   * True while the notice deadline is today or still ahead. `days` then
   * counts to it; once it has passed, `days` counts to the end date again.
   */
  beforeCancelBy: boolean;
  /** The count that drives urgency everywhere: cancel-by while it's ahead, else the end date. */
  days: number | null;
  /** The date `days` counts to. */
  keyDate: Date | null;
}

const DAY_MS = 86_400_000;

// Same calendar-day count as utils' daysUntil, against an explicit `now` so
// the reminder scheduler can run its check for a given moment.
function daysBetween(date: Date | null, now: Date): number | null {
  if (!date) return null;
  const startOfTarget = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const startOfNow = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((startOfTarget - startOfNow) / DAY_MS);
}

export function noticeApplies(input: Pick<ContractTimingInput, "noticePeriodDays" | "renewalType">): boolean {
  return input.renewalType !== "FIXED_TERM" && input.noticePeriodDays != null && input.noticePeriodDays > 0;
}

export function contractTiming(input: ContractTimingInput, now: Date = new Date()): ContractTiming {
  const end = input.endDate == null ? null : typeof input.endDate === "string" ? new Date(input.endDate) : input.endDate;
  const endDays = daysBetween(end, now);
  const cancelBy = end && noticeApplies(input) ? new Date(end.getTime() - input.noticePeriodDays! * DAY_MS) : null;
  const cancelByDays = daysBetween(cancelBy, now);
  const beforeCancelBy = cancelByDays != null && cancelByDays >= 0;

  return {
    endDays,
    cancelBy,
    cancelByDays,
    beforeCancelBy,
    days: beforeCancelBy ? cancelByDays : endDays,
    keyDate: beforeCancelBy ? cancelBy : end,
  };
}
