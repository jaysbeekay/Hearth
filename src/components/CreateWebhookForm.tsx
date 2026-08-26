"use client";

import { useActionState } from "react";
import { createWebhookEndpoint } from "@/lib/actions/webhook";
import type { ActionState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { inputClass } from "@/components/SelectWrapper";

export function CreateWebhookForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(createWebhookEndpoint, null);

  return (
    <form action={formAction} className="grid gap-3 md:grid-cols-2">
      <div className="space-y-1">
        <label htmlFor="name" className="text-sm font-medium">
          Name
        </label>
        <input
          id="name"
          name="name"
          required
          placeholder="Home Assistant"
          defaultValue={state?.values?.name}
          className={inputClass}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="url" className="text-sm font-medium">
          URL
        </label>
        <input
          id="url"
          name="url"
          type="url"
          required
          placeholder="https://homeassistant.local:8123/api/webhook/..."
          defaultValue={state?.values?.url}
          className={inputClass}
        />
      </div>
      <div className="space-y-1 md:col-span-2">
        <label htmlFor="secret" className="text-sm font-medium">
          Signing secret (optional)
        </label>
        <input id="secret" name="secret" type="password" className={inputClass} />
        <p className="text-xs text-muted">
          If set, each delivery includes an X-Webhook-Signature header (HMAC-SHA256 of the
          request body) so the receiver can verify it came from this app. Stored as-is in the
          database — leave blank to send unsigned.
        </p>
      </div>
      <div className="md:col-span-2">
        <FormMessage error={state?.error} success={state?.success} />
      </div>
      <div className="md:col-span-2">
        <SubmitButton>Add webhook</SubmitButton>
      </div>
    </form>
  );
}
