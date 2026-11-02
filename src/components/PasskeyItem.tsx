"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";
import { deletePasskeyCredential } from "@/lib/actions/passkeys";
import type { ActionState } from "@/lib/actions/auth";
import { ConfirmForm } from "@/components/ConfirmForm";
import { FormMessage } from "@/components/FormMessage";
import { Timestamp } from "@/components/Timestamp";
import { buttonClass } from "@/lib/ui";

export function PasskeyItem({
  credentialId,
  nickname,
  createdAt,
  lastUsedAt,
}: {
  credentialId: string;
  nickname: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}) {
  const [state] = useActionState<ActionState, FormData>(async () => null, null);

  return (
    <li className="flex items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {nickname ?? "Passkey"}
        </p>
        <p className="text-xs text-muted">
          Added <Timestamp value={createdAt} />
          {lastUsedAt ? (
            <>
              {" "}
              · Last used <Timestamp value={lastUsedAt} />
            </>
          ) : null}
        </p>
        <FormMessage attempt={state} error={state?.error} success={state?.success} />
      </div>
      <ConfirmForm
        action={deletePasskeyCredential.bind(null, credentialId)}
        confirmText={`Remove "${nickname ?? "this passkey"}"? You won't be able to sign in with it anymore.`}
        actionLabel="Remove passkey"
        ariaLabel={`Remove passkey ${nickname ?? ""}`}
        className={buttonClass("quiet", { icon: true }, "text-muted hover:text-danger")}
      >
        <Trash2 size={16} />
      </ConfirmForm>
    </li>
  );
}
