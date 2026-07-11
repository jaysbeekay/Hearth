"use client";

import { useActionState } from "react";
import { requestPasswordReset, type ActionState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";

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
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>

      <FormMessage error={state?.error} />

      <SubmitButton className="w-full">Send reset link</SubmitButton>
    </form>
  );
}
