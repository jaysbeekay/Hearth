import { cn, expiryLabel } from "@/lib/utils";

export function ExpiryBadge({
  days,
  cancelled,
  cancelBy,
}: {
  days: number | null;
  cancelled?: boolean;
  /** #351 — `days` counts to the last day to give notice, not the end date. */
  cancelBy?: boolean;
}) {
  const tone = cancelled
    ? "bg-slate-500/10 text-slate-500 dark:text-slate-400"
    : days == null
      ? "bg-slate-500/10 text-slate-500 dark:text-slate-400"
      : days < 0
        ? "bg-danger/10 text-danger"
        : days <= 7
          ? "bg-danger/10 text-danger"
          : days <= 30
            ? "bg-warning/10 text-warning"
            : "bg-success/10 text-success";

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium",
        tone,
      )}
    >
      {cancelled
        ? "Cancelled"
        : cancelBy && days != null && days >= 0
          ? days === 0
            ? "Notice due today"
            : `${days}d to give notice`
          : expiryLabel(days)}
    </span>
  );
}
