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
}: {
  children: React.ReactNode;
  className?: string;
  variant?: ButtonVariant;
  /** Danger text on a secondary/quiet button; filled danger is for confirm dialogs only. */
  destructive?: boolean;
  pendingText?: string;
}) {
  const { pending } = useFormStatus();
  // Before hydration a click submits the form natively. That POST carries
  // `Origin: null` (the app sends Referrer-Policy: no-referrer), so Next
  // rejects the server action and the click is lost; and a useActionState
  // result, like the calendar feed's one-time URL, could never be shown by
  // a native submit anyway (#609). Enabled once React handles the click.
  const hydrated = useHasMounted();

  return (
    <button type="submit" disabled={pending || !hydrated} className={buttonClass(variant, { destructive }, className)}>
      {pending ? pendingText : children}
    </button>
  );
}
