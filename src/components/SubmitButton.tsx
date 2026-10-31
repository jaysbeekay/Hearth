"use client";

import { useFormStatus } from "react-dom";
import { buttonClass, type ButtonVariant } from "@/lib/ui";

export function SubmitButton({
  children,
  className,
  variant = "primary",
  destructive,
  pendingText = "Saving…",
}: {
  children: React.ReactNode;
  className?: string;
  variant?: ButtonVariant;
  /** Danger text on a secondary/quiet button; filled danger is for confirm dialogs only. */
  destructive?: boolean;
  pendingText?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending} className={buttonClass(variant, { destructive }, className)}>
      {pending ? pendingText : children}
    </button>
  );
}
