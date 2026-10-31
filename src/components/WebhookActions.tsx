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
import { buttonClass } from "@/lib/ui";

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
          <SubmitButton variant="secondary">
            Send test
          </SubmitButton>
        </form>
        <form action={toggleAction}>
          <SubmitButton variant="secondary">
            {enabled ? "Disable" : "Enable"}
          </SubmitButton>
        </form>
        <ConfirmForm
          action={deleteWebhookEndpoint.bind(null, endpointId)}
          confirmText={`Remove the "${name}" webhook?`}
          actionLabel="Remove webhook"
          ariaLabel={`Remove webhook ${name}`}
          className={buttonClass("quiet", { icon: true }, "text-muted hover:text-danger")}
        >
          <Trash2 size={16} />
        </ConfirmForm>
      </div>
      <FormMessage error={testState?.error} success={testState?.success} />
      <FormMessage error={toggleState?.error} success={toggleState?.success} />
    </div>
  );
}
