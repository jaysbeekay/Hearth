"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BellOff, X } from "lucide-react";

const DISMISS_KEY = "hearth:notification-nudge-dismissed";

export function NotificationNudgeBanner() {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
  }, []);

  if (dismissed) return null;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
      <BellOff size={16} className="shrink-0 text-warning" />
      <span className="flex-1 text-foreground">
        Reminders are off — Hearth can email you before things expire.{" "}
        <Link href="/settings/app" className="font-medium text-accent hover:underline">
          Set up →
        </Link>
      </span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, "1");
          setDismissed(true);
        }}
        className="shrink-0 rounded-md p-1 text-muted hover:bg-black/5 dark:hover:bg-white/5"
      >
        <X size={14} />
      </button>
    </div>
  );
}
