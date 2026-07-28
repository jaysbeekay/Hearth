"use client";

import { useFormStatus } from "react-dom";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/lib/buttonStyles";

export function SubmitButton({
  children,
  className,
  variant = "primary",
  pendingText = "Saving…",
}: {
  children: React.ReactNode;
  className?: string;
  variant?: "primary" | "danger" | "secondary";
  pendingText?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        "inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-60 disabled:cursor-not-allowed",
        buttonVariants[variant],
        className,
      )}
    >
      {pending ? pendingText : children}
    </button>
  );
}
