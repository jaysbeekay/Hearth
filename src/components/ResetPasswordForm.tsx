"use client";

import { useActionState } from "react";
import Link from "next/link";
import { resetPassword, type ActionState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    resetPassword.bind(null, token),
    null,
  );

  if (state?.success) {
    return (
      <div className="space-y-4">
        <FormMessage success={state.success} />
        <Link
          href="/login"
          className="inline-flex w-full items-center justify-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
        >
          Continue to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1">
        <label htmlFor="password" className="text-sm font-medium">
          New password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>

      <FormMessage error={state?.error} />

      <SubmitButton className="w-full">Reset password</SubmitButton>
    </form>
  );
}
