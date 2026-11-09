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
  // rejects the server action and the click is lost: on the calendar feed,
  // the one-time URL never appeared (#609). Enabled once React handles the
  // click. tests/unit/ui-rules.test.ts keeps other submit buttons from
  // skipping this guard.
  const hydrated = useHasMounted();

  return (
    <button type="submit" disabled={pending || !hydrated} className={buttonClass(variant, { destructive }, className)}>
      {pending ? pendingText : children}
    </button>
  );
}
