// #422 — renders a Due label in the viewer's date format. The Due policy
// (duePolicy.ts, ADR 0002) says what a badge says, as a key and parameters;
// this decides how its date reads. Month names are English and day counts
// are plain digits whatever the Region, as everywhere else dates appear in
// the app, so the text never depends on the runtime's locale data and the
// server and browser render the same thing.
//
// Pure, so server components and client components (through
// DateFormatProvider) render the same text.

import { formatDueDate, renderDueLabel, type CalendarDay, type DueEntry, type DueLabelFormat } from "@/lib/duePolicy";
import { shortMonthName } from "@/lib/dateParts";

export interface DueLabelPreferences {
  dateFormat?: string | null;
}

/** "Nov 3", or "Nov 3, 2027" when it isn't this year. */
function monthFirst(day: CalendarDay, today: CalendarDay): string {
  const [, m, d] = day.split("-").map(Number);
  const short = `${shortMonthName(m)} ${d}`;
  return day.slice(0, 4) === today.slice(0, 4) ? short : `${short}, ${day.slice(0, 4)}`;
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

/** How Due labels read for a viewer with these Preferences. */
export function dueLabelFormat(prefs: DueLabelPreferences): DueLabelFormat {
  return { date: dueDateFormatter(prefs.dateFormat) };
}

/** A Due entry's label in the viewer's date format. */
export function formatDueLabel(entry: Pick<DueEntry, "labelParts">, prefs: DueLabelPreferences): string {
  return renderDueLabel(entry.labelParts, dueLabelFormat(prefs));
}
