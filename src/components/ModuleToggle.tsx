"use client";

import { useActionState } from "react";
import { toggleModule } from "@/lib/actions/modules";
import type { ActionState } from "@/lib/actions/auth";
import type { ModuleKey } from "@/lib/modules/registry";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { buttonClass } from "@/lib/ui";

export function ModuleToggle({ moduleKey, enabled }: { moduleKey: ModuleKey; enabled: boolean }) {
  const [state, action] = useActionState<ActionState, FormData>(
    async () => toggleModule(moduleKey, !enabled),
    null,
  );

  return (
    <div className="flex flex-col items-end gap-2">
      <form action={action}>
        <SubmitButton
          variant="secondary"
          className={buttonClass("secondary")}
        >
          {enabled ? "Disable" : "Enable"}
        </SubmitButton>
      </form>
      <FormMessage attempt={state} error={state?.error} success={state?.success} />
    </div>
  );
}
