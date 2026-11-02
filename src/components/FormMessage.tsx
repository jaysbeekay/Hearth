"use client";

import { useEffect, useRef } from "react";
import { showToast } from "@/components/Toast";
import { bannerClass } from "@/lib/ui";

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
    } else if (error && error !== lastShown.current) {
      showToast(error, "error");
      lastShown.current = error;
    }
  }, [success, error]);

  if (!error && !success) return null;

  return (
    <p className={bannerClass(error ? "danger" : "success")}>
      {error ?? success}
    </p>
  );
}
