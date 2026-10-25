import Link from "next/link";
import { AlertTriangle, AlertCircle, Upload, RotateCw } from "lucide-react";
import { TestConnectionButton } from "@/components/TestConnectionButton";
import type { ActionState } from "@/lib/actions/auth";

// A prominent status/action area for overdue or soon-to-expire records, so
// the next step (upload the missing document, or renew) is visible right at
// the top of the detail page instead of only inferable from the badge next
// to the title (#176). The needsReview row (#200) is an independent
// condition from expiry urgency — a record can need review with no expiry
// date in sight, or vice versa, so both render side by side when both apply.
export function DetailStatusBanner({
  days,
  hasDocuments,
  documentsHref,
  editHref,
  renewLabel,
  secondaryAction,
  cancelBy,
  needsReview,
}: {
  days: number | null;
  hasDocuments: boolean;
  documentsHref: string;
  editHref: string;
  renewLabel: string;
  /** Shown beside Renew/Upload in the expiry row — e.g. contract "Mark as cancelled" (#370). */
  secondaryAction?: React.ReactNode;
  /** #351 — formatted last day to give notice, when `days` counts to it rather than the end date. */
  cancelBy?: string;
  /** Set when extractionPending is true — some critical fields were auto-filled and haven't been confirmed yet. */
  needsReview?: { onConfirm: () => Promise<ActionState> };
}) {
  const showExpiry = days != null && days <= 30;
  if (!showExpiry && !needsReview) return null;

  const overdue = showExpiry && days! < 0;
  const tone = overdue ? "border-danger/30 bg-danger/10 text-danger" : "border-warning/30 bg-warning/10 text-warning";
  const message = showExpiry
    ? cancelBy && !overdue
      ? days === 0
        ? `Last day to give notice is today (${cancelBy}).`
        : `Give notice by ${cancelBy} — ${days} day${days === 1 ? "" : "s"} left.`
      : overdue
      ? `Expired ${Math.abs(days!)} day${Math.abs(days!) === 1 ? "" : "s"} ago.`
      : days === 0
        ? "Expires today."
        : `Expires in ${days} day${days === 1 ? "" : "s"}.`
    : "";

  return (
    <div className="space-y-2">
      {showExpiry && (
        <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 ${tone}`}>
          <p className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle size={16} className="shrink-0" aria-hidden />
            {message}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {secondaryAction}
            {hasDocuments ? (
              <Link
                href={editHref}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-hover-surface"
              >
                <RotateCw size={14} />
                {renewLabel}
              </Link>
            ) : (
              <Link
                href={documentsHref}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-hover-surface"
              >
                <Upload size={14} />
                Upload document
              </Link>
            )}
          </div>
        </div>
      )}
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
