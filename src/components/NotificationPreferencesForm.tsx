"use client";

import { useActionState } from "react";
import { updateNotificationPreferences, type ActionState } from "@/lib/actions/auth";
import { FormMessage } from "@/components/FormMessage";
import { compactButtonClass } from "@/lib/buttonStyles";

export function NotificationPreferencesForm({ emailReminders }: { emailReminders: boolean }) {
  const [state, formAction] = useActionState<ActionState, FormData>(updateNotificationPreferences, null);

  return (
    <form action={formAction} className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          id="emailReminders"
          name="emailReminders"
          type="checkbox"
          defaultChecked={emailReminders}
          className="size-4 rounded border-border accent-accent"
        />
        <label htmlFor="emailReminders" className="text-sm">
          Email me about contracts expiring soon
        </label>
        <button type="submit" className={`ml-auto ${compactButtonClass()}`}>
          Save
        </button>
      </div>
      <FormMessage error={state?.error} success={state?.success} />
    </form>
  );
}
