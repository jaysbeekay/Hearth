"use client";

import { useFormStatus } from "react-dom";
import { buttonClass, type ButtonVariant } from "@/lib/buttonStyles";

export function SubmitButton({
  children,
  className,
  variant = "primary",
  pendingText = "Saving…",
}: {
  children: React.ReactNode;
  className?: string;
  variant?: ButtonVariant;
  pendingText?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={buttonClass(variant, { className })}
    >
      {pending ? pendingText : children}
    </button>
  );
}
