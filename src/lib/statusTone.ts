// #412 — the one mapping from a record's status to the colour its pill or
// banner takes. Colour signals that something needs acting on by a date:
// danger once Overdue, warning while Due soon. Every other status (Ended,
// Lapsed, Cancelled, Needs review, a date that needs replacing, and
// other Housekeeping) is a neutral grey pill, and a date outside its
// due-soon window is plain muted text with no pill at all. Success is kept
// for confirmations, "Connected" and gains, never for a date.
//
// The text always says the state ("Expired 3 days ago", "Cancel by 3 Nov",
// "Needs review"), so colour is never the only signal. Every tone's text
// stays >= 4.5:1 on its tint in both themes (scripts/check-contrast.mjs).
//
// Pure (its only import is lib/ui, also pure), so server and client
// components share it. The pill and banner classes themselves live in lib/ui (#411).

import type { DueState } from "@/lib/duePolicy";
import { bannerToneClass, pillClass } from "@/lib/ui";

export type StatusTone = "danger" | "warning" | "neutral" | "plain";

/**
 * Every status a pill or banner shows: the Due policy's states, plus the
 * ones a record carries regardless of dates.
 */
export type RecordStatus =
  | DueState
  | "cancelled"
  /** A Vehicle or Property the household no longer has (#355). */
  | "archived"
  | "needs-review"
  /** Any other Housekeeping, such as missing details or a failed Reminder. */
  | "housekeeping"
  /** A record with no date to show, such as "No end date". */
  | "no-date";

/** The tone a status's pill or banner takes. */
export function statusTone(status: RecordStatus): StatusTone {
  switch (status) {
    case "overdue":
      return "danger";
    case "due-soon":
      return "warning";
    case "later":
      return "plain";
    case "ended":
    case "lapsed":
    case "needs-new-end-date":
    case "cancelled":
    case "archived":
    case "needs-review":
    case "housekeeping":
    case "no-date":
      return "neutral";
  }
}

const TEXT_CLASS = new Map<StatusTone, string>([
  ["danger", "text-danger"],
  ["warning", "text-warning"],
]);

/** The text colour for a status in running text: muted unless danger or warning. */
export function statusTextClass(tone: StatusTone): string {
  return TEXT_CLASS.get(tone) ?? "text-muted";
}

/** The classes for a status pill (or, for `plain`, its unpilled text) in a tone. */
export function statusPillClass(tone: StatusTone): string {
  return pillClass(tone);
}

/** The border, tint and text classes for a status banner in a tone. */
export function statusBannerClass(tone: StatusTone): string {
  return bannerToneClass(tone);
}
