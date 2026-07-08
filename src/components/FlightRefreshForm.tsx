"use client";

import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import type { ActionState } from "@/lib/actions/auth";

export function FlightRefreshForm({
  action,
}: {
  action: () => Promise<ActionState>;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => { void action(); })}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
    >
      <RefreshCw size={12} className={pending ? "animate-spin" : ""} />
      {pending ? "Refreshing…" : "Refresh"}
    </button>
  );
}
