import { StatusPill } from "@/components/StatusPill";
import { formatDate } from "@/lib/utils";

// #355 — the note at the top of an Archived Vehicle's or Property's page.
// `children` is the Restore button, for a member who can write.
export function ArchivedNotice({
  archivedAt,
  dateFormat,
  what,
  children,
}: {
  archivedAt: Date;
  dateFormat?: string;
  /** What stopped, in a phrase: "rego, insurance and service dates". */
  what: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      data-testid="archived-notice"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/10 px-4 py-3 text-sm"
    >
      <p className="flex flex-wrap items-center gap-2">
        <StatusPill status="archived">Archived</StatusPill>
        <span className="text-muted">
          Archived on {formatDate(archivedAt, dateFormat)}. Its {what} no longer remind you or show in Needs attention.
        </span>
      </p>
      {children}
    </div>
  );
}
