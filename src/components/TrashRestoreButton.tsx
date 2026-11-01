"use client";

import { useActionState } from "react";
import { RotateCcw } from "lucide-react";
import { SubmitButton } from "@/components/SubmitButton";
import { showToast } from "@/components/Toast";

// Trash → Restore. The restore actions report expected failures (a module
// that's off, a record that's gone) as { error }; this shows that instead of
// silently doing nothing.
export function TrashRestoreButton({ action }: { action: () => Promise<unknown> }) {
  const [, formAction] = useActionState(async () => {
    try {
      const result = await action();
      const error = (result as { error?: string } | null | undefined)?.error;
      if (error) showToast(error, "error");
      else showToast("Restored.");
    } catch {
      showToast("Couldn't restore it. Please try again.", "error");
    }
    return null;
  }, null);

  return (
    <form action={formAction}>
      <SubmitButton variant="secondary" pendingText="Restoring…">
        <RotateCcw size={16} className="mr-1.5" />
        Restore
      </SubmitButton>
    </form>
  );
}
