import Link from "next/link";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  tone = "default",
  href,
}: {
  label: string;
  value: string;
  tone?: "default" | "warning" | "danger" | "info";
  href?: string;
}) {
  const toneClasses = {
    default: "text-foreground",
    warning: "text-warning",
    danger: "text-danger",
    info: "text-info",
  };

  const content = (
    <>
      <p className="text-sm text-muted">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tracking-tight tabular-nums", toneClasses[tone])}>{value}</p>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="rounded-lg border border-border bg-surface p-4 shadow-stripe transition-colors hover:border-accent/40 hover:bg-black/5 dark:hover:bg-white/5"
      >
        {content}
      </Link>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-stripe">
      {content}
    </div>
  );
}
