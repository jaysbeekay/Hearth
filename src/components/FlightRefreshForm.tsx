"use client";

import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import type { ActionState } from "@/lib/actions/auth";
import { buttonClass } from "@/lib/buttonStyles";

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
      className={buttonClass("secondary")}
    >
      <RefreshCw size={16} className={pending ? "animate-spin" : ""} />
      {pending ? "Refreshing…" : "Refresh"}
    </button>
  );
}
