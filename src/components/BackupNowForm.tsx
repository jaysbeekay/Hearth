"use client";

import { useActionState } from "react";
import { triggerBackup } from "@/lib/actions/backup";
import type { ActionState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";

export function BackupNowForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(triggerBackup, null);

  return (
    <form action={formAction} className="space-y-3">
      <FormMessage attempt={state} error={state?.error} success={state?.success} />
      <SubmitButton variant="secondary">Back up now</SubmitButton>
    </form>
  );
}
