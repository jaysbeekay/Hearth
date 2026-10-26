"use client";

import { useDisplayPreferences } from "@/components/DateFormatProvider";
import { formatTimestamp } from "@/lib/utils";

// #422 — the day a moment in time (an upload, a send, a sign-in) fell on, in
// the viewer's display timezone. Calendar dates use formatDate instead,
// which reads them in UTC. `dateFormat` overrides the viewer's own when a
// caller already has it.
export function Timestamp({ value, dateFormat }: { value: Date | string | null | undefined; dateFormat?: string | null }) {
  const prefs = useDisplayPreferences();
  return <>{formatTimestamp(value, dateFormat ?? prefs.dateFormat, prefs.timeZone)}</>;
}
