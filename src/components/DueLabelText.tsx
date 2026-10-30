"use client";

import { useDisplayPreferences } from "@/components/DateFormatProvider";
import { formatDueLabel } from "@/lib/dueLabel";
import type { DueEntry } from "@/lib/duePolicy";

// #422 — a Due entry's label in the viewer's date format. A client component
// so server-rendered badges and client list cards read the same
// Preferences, from DateFormatProvider.
export function DueLabelText({ entry }: { entry: Pick<DueEntry, "labelParts"> }) {
  return <>{formatDueLabel(entry, useDisplayPreferences())}</>;
}
