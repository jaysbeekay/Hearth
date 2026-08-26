import { formatDate } from "@/lib/utils";

export function RecordMeta({
  createdByName,
  createdAt,
  updatedAt,
  updatedByName,
  dateFormat,
  extractionConfirmedAt,
  memberCount,
}: {
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
  /** #286 — who last edited the record. Null/undefined (e.g. a row edited
   * before this field existed, or by a since-removed member) falls back to
   * the old "Last updated {date}" wording rather than naming no one. */
  updatedByName?: string | null;
  dateFormat?: string;
  /** #200 — when set, shown so it's clear the auto-filled fields were reviewed, not just accepted by default. */
  extractionConfirmedAt?: Date | null;
  /** #285 — household size, so visibility reads as a stated fact ("all 4
   * members") rather than a vague reassurance. Omitted (rather than showing
   * a wrong number) if the caller couldn't look it up. */
  memberCount?: number;
}) {
  const wasUpdated = updatedAt.getTime() !== createdAt.getTime();

  return (
    <p className="text-xs text-muted">
      Added by {createdByName} on {formatDate(createdAt, dateFormat)}
      {wasUpdated &&
        (updatedByName
          ? ` · Last changed by ${updatedByName} on ${formatDate(updatedAt, dateFormat)}`
          : ` · Last updated ${formatDate(updatedAt, dateFormat)}`)}
      {extractionConfirmedAt &&
        ` · Auto-filled details confirmed ${formatDate(extractionConfirmedAt, dateFormat)}`}
      {memberCount != null &&
        ` · Visible to ${memberCount === 1 ? "you" : `all ${memberCount} household members`}`}
    </p>
  );
}
