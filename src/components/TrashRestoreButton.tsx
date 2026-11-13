"use client";

import { useActionState, useRef } from "react";
import { RotateCcw } from "lucide-react";
import { SubmitButton } from "@/components/SubmitButton";
import { showToast } from "@/components/Toast";
import { captureFocusOrigin, returnFocus, type FocusOrigin } from "@/lib/focusReturn";

// Trash → Restore. The restore actions report expected failures (a module
// that's off, a record that's gone) as { error }; this shows that instead of
// silently doing nothing.
export function TrashRestoreButton({ action }: { action: () => Promise<unknown> }) {
  // #646 — a restored entry leaves the list, taking the focused button with
  // it, so focus is handed on to a neighbouring entry.
  const originRef = useRef<FocusOrigin | null>(null);
  const [, formAction] = useActionState(async () => {
    const origin = originRef.current;
    try {
      const result = await action();
      const error = (result as { error?: string } | null | undefined)?.error;
      if (error) showToast(error, "error");
      else showToast("Restored.");
      if (origin) returnFocus(origin, { removed: !error });
    } catch {
      showToast("Couldn't restore it. Please try again.", "error");
      if (origin) returnFocus(origin);
    }
    return null;
  }, null);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const submitter = (e.nativeEvent as SubmitEvent).submitter;
        originRef.current = captureFocusOrigin(submitter instanceof HTMLElement ? submitter : e.currentTarget);
      }}
    >
      <SubmitButton variant="secondary" pendingText="Restoring…">
        <RotateCcw size={16} className="mr-1.5" />
        Restore
      </SubmitButton>
    </form>
  );
}
