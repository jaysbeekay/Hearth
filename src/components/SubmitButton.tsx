"use client";

import { useFormStatus } from "react-dom";
import { cn } from "@/lib/utils";

export const buttonVariants = {
  primary: "bg-accent text-accent-foreground hover:opacity-90",
  danger: "bg-danger text-white hover:opacity-90",
  secondary:
    "bg-transparent border border-border hover:bg-black/5 dark:hover:bg-white/5",
};

// Shared with SubmitButton (real <button type="submit"> elements) so
// <Link>-as-button "add record" affordances on list pages use the same
// visual definition instead of re-declaring it per page.
export function linkButtonClass(
  variant: keyof typeof buttonVariants = "primary",
  { online = true }: { online?: boolean } = {},
) {
  return cn(
    "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium",
    buttonVariants[variant],
    !online && "pointer-events-none opacity-40",
  );
}

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
        "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-60 disabled:cursor-not-allowed",
        buttonVariants[variant],
        className,
      )}
    >
      {pending ? pendingText : children}
    </button>
  );
}
