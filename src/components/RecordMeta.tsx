import { formatDate } from "@/lib/utils";

export function RecordMeta({
  createdByName,
  createdAt,
  updatedAt,
  dateFormat,
  extractionConfirmedAt,
}: {
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
  dateFormat?: string;
  /** #200 — when set, shown so it's clear the auto-filled fields were reviewed, not just accepted by default. */
  extractionConfirmedAt?: Date | null;
}) {
  const wasUpdated = updatedAt.getTime() !== createdAt.getTime();

  return (
    <p className="text-xs text-foreground/40">
      Added by {createdByName} on {formatDate(createdAt, dateFormat)}
      {wasUpdated && ` · Last updated ${formatDate(updatedAt, dateFormat)}`}
      {extractionConfirmedAt &&
        ` · Auto-filled details confirmed ${formatDate(extractionConfirmedAt, dateFormat)}`}
    </p>
  );
}
