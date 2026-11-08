"use client";

import { useActionState } from "react";
import { setAssistantEnabled, type ActionState } from "@/lib/actions/chatSettings";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";

// Household on/off switch for the AI assistant, beside its provider settings.
export function AssistantEnabledToggle({
  enabled,
  configured,
}: {
  enabled: boolean;
  configured: boolean;
}) {
  const [state, action] = useActionState<ActionState, FormData>(setAssistantEnabled, null);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium">{enabled ? "Assistant is on" : "Assistant is off"}</p>
        <p className="text-xs text-muted">
          {enabled
            ? configured
              ? "Household members can open it from the Assistant page."
              : "Choose a provider below so members can start chatting."
            : "Nobody in the household sees the assistant. Saved provider settings are kept."}
        </p>
      </div>
      <form action={action}>
        <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
        <SubmitButton variant="secondary">
          {enabled ? "Turn off" : "Turn on"}
        </SubmitButton>
      </form>
      <FormMessage attempt={state} error={state?.error} success={state?.success} />
    </div>
  );
}
