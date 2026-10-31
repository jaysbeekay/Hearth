"use client";

import Link from "next/link";
import { buttonClass } from "@/lib/buttonStyles";

export default function AppError({
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
          <h1 className="text-2xl font-medium">Something went wrong</h1>
          <p className="text-sm text-muted">
            {error.message || "That action couldn't be completed. If your account has read-only access, this may be why."}
          </p>
        </div>
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className={buttonClass("secondary")}
          >
            Try again
          </button>
          <Link
            href="/dashboard"
            className={buttonClass("primary")}
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
