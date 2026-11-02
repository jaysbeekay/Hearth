"use client";

import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Whether any of a collapsed section's fields already holds something, so the
 * section opens instead of hiding a stored value (#361).
 */
export function hasAnyValue(values: unknown[]): boolean {
  return values.some((value) => {
    if (value === null || value === undefined || value === false) return false;
    if (typeof value === "string") return value.trim() !== "";
    return true;
  });
}

/**
 * #361 — a collapsible group of optional form fields ("More details",
 * "Reminders"). It opens on its own when it holds values, when document
 * extraction fills a field inside it (see markAutoFilled), and when the
 * browser's validation flags a field inside it, so nothing it holds is ever
 * hidden from review.
 */
export function FormSection({
  title,
  hint,
  defaultOpen = false,
  className,
  children,
}: {
  title: string;
  /** A few words on what's inside, shown next to the title while collapsed. */
  hint?: string;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <details
      data-form-section
      open={defaultOpen || undefined}
      // `invalid` doesn't bubble, so catch it on the way down: a closed
      // section would otherwise leave the browser unable to focus the field.
      onInvalidCapture={(e) => {
        e.currentTarget.open = true;
      }}
      className={cn("group rounded-lg border border-border", className)}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg p-4 text-sm font-medium hover:bg-foreground/5 [&::-webkit-details-marker]:hidden">
        <span>
          {title}
          {hint && <span className="ml-2 font-normal text-muted group-open:hidden">{hint}</span>}
        </span>
        <ChevronDown size={16} className="shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="space-y-4 border-t border-border p-4">{children}</div>
    </details>
  );
}
