import { DueLabelText } from "@/components/DueLabelText";
import { StatusPill } from "@/components/StatusPill";
import type { DueEntry } from "@/lib/dueRecords";

// #384 — renders a Due entry's state and label, both from the Due policy
// (ADR 0002). It decides nothing itself. #422 — the label reads in the
// viewer's date format and region. #412 — its colour comes from
// statusTone: a pill only for Overdue, Due soon and the neutral states; a
// date outside its due-soon window is plain text.
export function ExpiryBadge({
  entry,
  cancelled,
  empty = "No end date",
}: {
  entry: DueEntry | null;
  /** A Cancelled Contract has no Due entries; it reads "Cancelled". */
  cancelled?: boolean;
  /** What a record with no dated entry reads, such as "No end date". */
  empty?: string;
}) {
  if (cancelled) return <StatusPill status="cancelled">Cancelled</StatusPill>;
  if (!entry) return <StatusPill status="no-date">{empty}</StatusPill>;
  return (
    <StatusPill status={entry.state}>
      <DueLabelText entry={entry} />
    </StatusPill>
  );
}
