import { cn } from "@/lib/utils";
import { dueTone, type DueEntry, type DueTone } from "@/lib/dueRecords";

const TONE_CLASS = new Map<DueTone, string>([
  ["danger", "bg-danger/10 text-danger"],
  ["warning", "bg-warning/10 text-warning"],
  ["success", "bg-success/10 text-success"],
  ["neutral", "bg-muted/10 text-muted"],
]);

// #384 — renders a Due entry's state and label, both from the Due policy
// (ADR 0002). It decides nothing itself.
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
  const tone = cancelled || !entry ? "neutral" : dueTone(entry.state);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium",
        TONE_CLASS.get(tone),
      )}
    >
      {cancelled ? "Cancelled" : (entry?.label ?? empty)}
    </span>
  );
}
