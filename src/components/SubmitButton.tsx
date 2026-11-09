"use client";

import { useFormStatus } from "react-dom";
import { buttonClass, type ButtonVariant } from "@/lib/ui";
import { useHasMounted } from "@/lib/useHasMounted";

export function SubmitButton({
  children,
  className,
  variant = "primary",
  destructive,
  pendingText = "Saving…",
  disabledUntilHydrated = false,
}: {
  children: React.ReactNode;
  className?: string;
  variant?: ButtonVariant;
  /** Danger text on a secondary/quiet button; filled danger is for confirm dialogs only. */
  destructive?: boolean;
  pendingText?: string;
  /**
   * Disable the button until React has hydrated, for forms whose result only
   * exists in client state: a click before then would submit natively and
   * reload the page, losing it (#609). Off by default.
   */
  disabledUntilHydrated?: boolean;
}) {
  const { pending } = useFormStatus();
  const hydrated = useHasMounted();
  const disabled = pending || (disabledUntilHydrated && !hydrated);

  return (
    <button type="submit" disabled={disabled} className={buttonClass(variant, { destructive }, className)}>
      {pending ? pendingText : children}
    </button>
  );
}
