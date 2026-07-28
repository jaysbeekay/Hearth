"use client";

import { useActionState } from "react";
import Link from "next/link";
import { resetPassword, type ActionState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { linkButtonClass } from "@/lib/buttonStyles";
import { FormMessage } from "@/components/FormMessage";
import { inputClass } from "@/components/SelectWrapper";

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
          className={`${linkButtonClass("primary")} w-full justify-center`}
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
          className={inputClass}
        />
      </div>

      <FormMessage error={state?.error} />

      <SubmitButton className="w-full">Reset password</SubmitButton>
    </form>
  );
}
