"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";
import { deletePasskeyCredential } from "@/lib/actions/passkeys";
import type { ActionState } from "@/lib/actions/auth";
import { ConfirmForm } from "@/components/ConfirmForm";
import { FormMessage } from "@/components/FormMessage";
import { formatDate } from "@/lib/utils";

export function PasskeyItem({
  credentialId,
  nickname,
  createdAt,
  lastUsedAt,
  dateFormat,
}: {
  credentialId: string;
  nickname: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  dateFormat?: string;
}) {
  const [state] = useActionState<ActionState, FormData>(async () => null, null);

  return (
    <li className="flex items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {nickname ?? "Passkey"}
        </p>
        <p className="text-xs text-foreground/50">
          Added {formatDate(createdAt, dateFormat)}
          {lastUsedAt ? ` · Last used ${formatDate(lastUsedAt, dateFormat)}` : ""}
        </p>
        <FormMessage error={state?.error} success={state?.success} />
      </div>
      <ConfirmForm
        action={deletePasskeyCredential.bind(null, credentialId)}
        confirmText={`Remove "${nickname ?? "this passkey"}"? You won't be able to sign in with it anymore.`}
        ariaLabel={`Remove passkey ${nickname ?? ""}`}
        className="rounded-md p-2 text-foreground/50 hover:text-danger"
      >
        <Trash2 size={16} />
      </ConfirmForm>
    </li>
  );
}
