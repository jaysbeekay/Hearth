// #422 — renders a Due label in the viewer's Preferences. The Due policy
// (duePolicy.ts, ADR 0002) says what a badge says, as a key and parameters;
// this decides how its date and numbers read: the date in the viewer's date
// format, day counts in their region's number style. Month names stay in
// English whatever the region, as everywhere else in the app (utils.ts).
//
// Pure, so server components and client components (through
// DateFormatProvider) render the same text.

import {
  formatDueDate,
  renderDueLabel,
  shortMonthName,
  type CalendarDay,
  type DueEntry,
  type DueLabelFormat,
} from "@/lib/duePolicy";
import { DEFAULT_REGION, REGION_OPTIONS } from "@/lib/utils";

export interface DueLabelPreferences {
  dateFormat?: string | null;
  region?: string | null;
}

function sameYear(day: CalendarDay, today: CalendarDay): boolean {
  return day.slice(0, 4) === today.slice(0, 4);
}

/** "Nov 3", or "Nov 3, 2027" when it isn't this year. */
function monthFirst(day: CalendarDay, today: CalendarDay): string {
  const [, m, d] = day.split("-").map(Number);
  const short = `${shortMonthName(m)} ${d}`;
  return sameYear(day, today) ? short : `${short}, ${day.slice(0, 4)}`;
}

/** The date part of a Due label in a date format: the year only when it isn't this year, except in ISO. */
function dueDateFormatter(dateFormat: string | null | undefined): DueLabelFormat["date"] {
  switch (dateFormat) {
    case "MM/DD/YYYY":
      return monthFirst;
    case "YYYY-MM-DD":
      // An ISO date without its year reads ambiguously, so it keeps it.
      return (day) => day;
    default:
      return formatDueDate;
  }
}

function regionOf(region: string | null | undefined): string {
  return REGION_OPTIONS.find((r) => r === region) ?? DEFAULT_REGION;
}

/** How Due labels read for a viewer with these Preferences. */
export function dueLabelFormat(prefs: DueLabelPreferences): DueLabelFormat {
  const region = regionOf(prefs.region);
  return {
    date: dueDateFormatter(prefs.dateFormat),
    count: (n) => n.toLocaleString(region),
  };
}

/** A Due entry's label in the viewer's date format and region. */
export function formatDueLabel(entry: Pick<DueEntry, "labelParts">, prefs: DueLabelPreferences): string {
  return renderDueLabel(entry.labelParts, dueLabelFormat(prefs));
}

/** A day count ("3") in the viewer's region. */
export function formatDayCount(n: number, prefs: DueLabelPreferences): string {
  return dueLabelFormat(prefs).count(n);
}
