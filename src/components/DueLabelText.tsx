"use client";

import { useDisplayPreferences } from "@/components/DateFormatProvider";
import { formatDayCount, formatDueLabel } from "@/lib/dueLabel";
import type { DueEntry } from "@/lib/duePolicy";

// #422 — a Due entry's label in the viewer's date format and region. A client
// component so server-rendered badges and client list cards read the same
// Preferences, from DateFormatProvider.
export function DueLabelText({ entry }: { entry: Pick<DueEntry, "labelParts"> }) {
  return <>{formatDueLabel(entry, useDisplayPreferences())}</>;
}

/** A day count in the viewer's region. */
export function DayCount({ days }: { days: number }) {
  return <>{formatDayCount(days, useDisplayPreferences())}</>;
}
