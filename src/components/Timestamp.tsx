"use client";

import { useDisplayPreferences } from "@/components/DateFormatProvider";
import { formatTimestamp } from "@/lib/utils";

// #422 — the day a moment in time (an upload, a send, a sign-in) fell on, in
// the viewer's date format and display timezone, both from
// DateFormatProvider. Calendar dates use formatDate instead, which reads them
// in UTC. The text is built from numeric parts and one English month table,
// and an invalid zone reads as UTC, so server and browser render the same.
export function Timestamp({ value }: { value: Date | string | null | undefined }) {
  const { dateFormat, timeZone } = useDisplayPreferences();
  return <>{formatTimestamp(value, dateFormat, timeZone)}</>;
}
