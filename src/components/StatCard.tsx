import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warning" | "danger" | "info";
}) {
  const toneClasses = {
    default: "text-foreground",
    warning: "text-warning",
    danger: "text-danger",
    info: "text-info",
  };

  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-stripe">
      <p className="text-sm text-muted">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tracking-tight tabular-nums", toneClasses[tone])}>{value}</p>
    </div>
  );
}
