"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { showToast } from "@/components/Toast";

export function FormMessage({
  error,
  success,
}: {
  error?: string | null;
  success?: string | null;
}) {
  const lastShown = useRef<string | null>(null);

  useEffect(() => {
    if (success && success !== lastShown.current) {
      showToast(success);
      lastShown.current = success;
    }
  }, [success]);

  if (!error && !success) return null;

  return (
    <p
      className={cn(
        "rounded-lg px-3 py-2 text-sm",
        error ? "bg-danger/10 text-danger" : "bg-success/10 text-success",
      )}
    >
      {error ?? success}
    </p>
  );
}
