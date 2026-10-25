import Link from "next/link";
import { AlertTriangle, AlertCircle, CalendarClock, Upload, RotateCw } from "lucide-react";
import { TestConnectionButton } from "@/components/TestConnectionButton";
import { bannerEntries, dueTone, type DueEntry, type DueTone } from "@/lib/dueRecords";
import type { ActionState } from "@/lib/actions/auth";

const TONE_CLASS = new Map<DueTone, string>([
  ["danger", "border-danger/30 bg-danger/10 text-danger"],
  ["warning", "border-warning/30 bg-warning/10 text-warning"],
  ["neutral", "border-border bg-muted/10 text-foreground"],
]);

const actionClass =
  "inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-hover-surface";

// The policy's label, plus how many days are left while there are some.
function message(entry: DueEntry, note?: string): string {
  if (entry.state === "needs-new-end-date") return note ? `${entry.label} — ${note}` : `${entry.label}.`;
  if (entry.daysLeft > 0) return `${entry.label} — ${entry.daysLeft} day${entry.daysLeft === 1 ? "" : "s"} left.`;
  return `${entry.label}.`;
}

// A prominent status/action area at the top of a detail page for each of
// the record's Due entries that needs acting on (#176), so the next step
// (renew, upload the missing document, or set the new end date) is visible
// right away. #384 — the entries, their states and labels come from the
// Due policy: danger once overdue, warning while due soon, neutral for a
// date that has passed and needs a new one (Housekeeping). Later, Ended and
// Lapsed entries show only as the badge. The needsReview row (#200) is
// independent of dates, so both render side by side when both apply.
export function DetailStatusBanner({
  entries,
  hasDocuments,
  documentsHref,
  editHref,
  renewLabel,
  secondaryAction,
  newEndDateLabel = "Set the new end date",
  newEndDateNote,
  needsReview,
}: {
  /** The record's Due entries, as the Due policy returns them. */
  entries: DueEntry[];
  hasDocuments: boolean;
  documentsHref: string;
  editHref: string;
  renewLabel: string;
  /** Shown beside Renew/Upload on a Due row — e.g. contract "Mark as cancelled" (#370). */
  secondaryAction?: React.ReactNode;
  /** The action on a row whose date has passed and needs replacing. */
  newEndDateLabel?: string;
  /** Explains that row, such as why an auto-renewing Contract needs one. */
  newEndDateNote?: string;
  /** Set when extractionPending is true — some critical fields were auto-filled and haven't been confirmed yet. */
  needsReview?: { onConfirm: () => Promise<ActionState> };
}) {
  const shown = bannerEntries(entries);
  if (shown.length === 0 && !needsReview) return null;

  return (
    <div className="space-y-2">
      {shown.map((entry) => {
        const housekeeping = entry.state === "needs-new-end-date";
        const Icon = housekeeping ? CalendarClock : AlertTriangle;
        return (
          <div
            key={entry.field}
            className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 ${TONE_CLASS.get(dueTone(entry.state))}`}
          >
            <p className="flex items-center gap-2 text-sm font-medium">
              <Icon size={16} className="shrink-0" aria-hidden />
              {message(entry, newEndDateNote)}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {housekeeping ? (
                <Link href={editHref} className={actionClass}>
                  <CalendarClock size={14} />
                  {newEndDateLabel}
                </Link>
              ) : (
                <>
                  {secondaryAction}
                  {hasDocuments ? (
                    <Link href={editHref} className={actionClass}>
                      <RotateCw size={14} />
                      {renewLabel}
                    </Link>
                  ) : (
                    <Link href={documentsHref} className={actionClass}>
                      <Upload size={14} />
                      Upload document
                    </Link>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
      {needsReview && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/10 p-3 text-foreground">
          <p className="flex items-center gap-2 text-sm font-medium">
            <AlertCircle size={16} className="shrink-0" aria-hidden />
            Needs review — some details were filled in automatically and haven&apos;t been confirmed
            yet. Reminders are on hold until then.
          </p>
          <TestConnectionButton action={needsReview.onConfirm} label="Confirm details" />
        </div>
      )}
    </div>
  );
}
