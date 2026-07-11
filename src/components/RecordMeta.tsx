import { formatDate } from "@/lib/utils";

export function RecordMeta({
  createdByName,
  createdAt,
  updatedAt,
  dateFormat,
}: {
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
  dateFormat?: string;
}) {
  const wasUpdated = updatedAt.getTime() !== createdAt.getTime();

  return (
    <p className="text-xs text-foreground/40">
      Added by {createdByName} on {formatDate(createdAt, dateFormat)}
      {wasUpdated && ` · Last updated ${formatDate(updatedAt, dateFormat)}`}
    </p>
  );
}
