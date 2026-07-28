"use client";

import { useActionState } from "react";
import { requestPasswordReset, type ActionState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { inputClass } from "@/components/SelectWrapper";

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(
    requestPasswordReset,
    null,
  );

  if (state?.success) {
    return <FormMessage success={state.success} />;
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className={inputClass}
        />
      </div>

      <FormMessage error={state?.error} />

      <SubmitButton className="w-full">Send reset link</SubmitButton>
    </form>
  );
}
