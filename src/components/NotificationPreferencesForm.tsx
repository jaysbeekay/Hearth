"use client";

import { useActionState } from "react";
import { updateNotificationPreferences, type ActionState } from "@/lib/actions/auth";
import { FormMessage } from "@/components/FormMessage";
import { GroupedSubmit } from "@/components/SaveChangesGroup";

export function NotificationPreferencesForm({ emailReminders }: { emailReminders: boolean }) {
  const [state, formAction] = useActionState<ActionState, FormData>(updateNotificationPreferences, null);

  return (
    <form action={formAction} data-save-group className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          id="emailReminders"
          name="emailReminders"
          type="checkbox"
          defaultChecked={emailReminders}
          className="size-4 rounded border-border accent-accent"
        />
        <label htmlFor="emailReminders" className="text-sm">
          Email me reminders (contracts, warranties, vehicles)
        </label>
        <span className="ml-auto empty:hidden">
          <GroupedSubmit>Save</GroupedSubmit>
        </span>
      </div>
      <FormMessage attempt={state} error={state?.error} success={state?.success} />
    </form>
  );
}
