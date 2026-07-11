"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";
import {
  deleteWebhookEndpoint,
  sendTestWebhookAction,
  toggleWebhookEndpoint,
} from "@/lib/actions/webhook";
import type { ActionState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { ConfirmForm } from "@/components/ConfirmForm";

const buttonClass =
  "rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5";

export function WebhookActions({
  endpointId,
  enabled,
  name,
}: {
  endpointId: string;
  enabled: boolean;
  name: string;
}) {
  const [testState, testAction] = useActionState<ActionState, FormData>(
    async () => sendTestWebhookAction(endpointId),
    null,
  );
  const [toggleState, toggleAction] = useActionState<ActionState, FormData>(
    async () => toggleWebhookEndpoint(endpointId, !enabled),
    null,
  );

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <form action={testAction}>
          <SubmitButton variant="secondary" className={buttonClass}>
            Send test
          </SubmitButton>
        </form>
        <form action={toggleAction}>
          <SubmitButton variant="secondary" className={buttonClass}>
            {enabled ? "Disable" : "Enable"}
          </SubmitButton>
        </form>
        <ConfirmForm
          action={deleteWebhookEndpoint.bind(null, endpointId)}
          confirmText={`Remove the "${name}" webhook?`}
          ariaLabel={`Remove webhook ${name}`}
          className="rounded-md p-2 text-foreground/50 hover:text-danger"
        >
          <Trash2 size={16} />
        </ConfirmForm>
      </div>
      <FormMessage error={testState?.error} success={testState?.success} />
      <FormMessage error={toggleState?.error} success={toggleState?.success} />
    </div>
  );
}
