"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="flex flex-col items-center gap-2">
          <AlertTriangle size={32} className="text-accent" />
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-foreground/60">
            {error.message || "That action couldn't be completed. Please try again."}
          </p>
        </div>
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
          >
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
          >
            Back to Hearth
          </Link>
        </div>
      </div>
    </div>
  );
}
