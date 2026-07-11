"use client";

import { useFormStatus } from "react-dom";
import { cn } from "@/lib/utils";

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

  const variants = {
    primary: "bg-accent text-accent-foreground hover:opacity-90",
    danger: "bg-danger text-white hover:opacity-90",
    secondary: "bg-transparent border border-border hover:bg-black/5 dark:hover:bg-white/5",
  };

  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-60 disabled:cursor-not-allowed",
        variants[variant],
        className,
      )}
    >
      {pending ? pendingText : children}
    </button>
  );
}
