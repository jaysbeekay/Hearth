import { pillClass, type PillTone } from "@/lib/ui";

// #411 — the one status pill. Filter chips are secondary buttons, not pills.
export function Pill({
  tone = "neutral",
  className,
  ...props
}: { tone?: PillTone } & React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={pillClass(tone, className)} {...props} />;
}
