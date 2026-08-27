"use client";

import { useState, useTransition } from "react";
import { Star } from "lucide-react";
import { showToast } from "@/components/Toast";
import { cn } from "@/lib/utils";

// #208 — a lightweight star toggle for flagging a document for quick
// retrieval later (e.g. via the "Important" search filter). Optimistic with
// rollback on error, matching ConfirmForm's pending/error handling but
// without a confirmation step since toggling is trivially reversible.
export function ImportantToggle({
  isImportant,
  action,
  label,
}: {
  isImportant: boolean;
  action: (next: boolean) => Promise<{ error?: string } | null | void>;
  label: string;
}) {
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState(isImportant);

  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={optimistic}
      aria-label={optimistic ? `Unmark ${label} as important` : `Mark ${label} as important`}
      onClick={() => {
        const next = !optimistic;
        setOptimistic(next);
        startTransition(async () => {
          const result = await action(next);
          if (result?.error) {
            setOptimistic(!next);
            showToast(result.error, "error");
          }
        });
      }}
      className={cn(
        "rounded-md p-2 hover:bg-black/5 dark:hover:bg-white/5",
        optimistic ? "text-warning" : "text-muted",
      )}
    >
      <Star size={16} fill={optimistic ? "currentColor" : "none"} />
    </button>
  );
}
