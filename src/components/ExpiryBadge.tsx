import { cn, expiryLabel } from "@/lib/utils";

export function ExpiryBadge({
  days,
  cancelled,
}: {
  days: number | null;
  cancelled?: boolean;
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
            ? "bg-amber-500/10 text-warning"
            : "bg-success/10 text-success";

  return (
    <span className={cn("inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium", tone)}>
      {cancelled ? "Cancelled" : expiryLabel(days)}
    </span>
  );
}
