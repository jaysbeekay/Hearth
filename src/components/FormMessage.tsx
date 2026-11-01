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
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (success && success !== lastShown.current) {
      showToast(success);
      lastShown.current = success;
    } else if (error && error !== lastShown.current) {
      // #406 — an error is shown once, in this banner, not also as a toast.
      // The banner sits at the foot of the form, so bring it into view.
      errorRef.current?.scrollIntoView?.({ block: "center" });
      lastShown.current = error;
    }
  }, [success, error]);

  if (!error && !success) return null;

  if (error) {
    return (
      <p ref={errorRef} role="alert" className={bannerClass("danger")}>
        {error}
      </p>
    );
  }

  return <p className={bannerClass("success")}>{success}</p>;
}
