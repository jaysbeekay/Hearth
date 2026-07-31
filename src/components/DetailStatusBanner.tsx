import Link from "next/link";
import { AlertTriangle, Upload, RotateCw } from "lucide-react";

// A prominent status/action area for overdue or soon-to-expire records, so
// the next step (upload the missing document, or renew) is visible right at
// the top of the detail page instead of only inferable from the badge next
// to the title (#176).
export function DetailStatusBanner({
  days,
  hasDocuments,
  documentsHref,
  editHref,
  renewLabel,
}: {
  days: number | null;
  hasDocuments: boolean;
  documentsHref: string;
  editHref: string;
  renewLabel: string;
}) {
  if (days == null || days > 30) return null;
  const overdue = days < 0;

  const tone = overdue ? "border-danger/30 bg-danger/10 text-danger" : "border-warning/30 bg-warning/10 text-warning";
  const message = overdue
    ? `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago.`
    : days === 0
      ? "Expires today."
      : `Expires in ${days} day${days === 1 ? "" : "s"}.`;

  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 ${tone}`}>
      <p className="flex items-center gap-2 text-sm font-medium">
        <AlertTriangle size={16} className="shrink-0" aria-hidden />
        {message}
      </p>
      {hasDocuments ? (
        <Link
          href={editHref}
          className="inline-flex items-center gap-2 rounded-lg bg-current/10 px-3 py-1.5 text-xs font-medium hover:opacity-80"
        >
          <RotateCw size={14} />
          {renewLabel}
        </Link>
      ) : (
        <Link
          href={documentsHref}
          className="inline-flex items-center gap-2 rounded-lg bg-current/10 px-3 py-1.5 text-xs font-medium hover:opacity-80"
        >
          <Upload size={14} />
          Upload document
        </Link>
      )}
    </div>
  );
}
