"use client";

import { useActionState } from "react";
import Link from "next/link";
import { acceptInvitation, type ActionState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { inputClass } from "@/components/SelectWrapper";
import { buttonClass } from "@/lib/ui";

export function AcceptInvitationForm({ token }: { token: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    acceptInvitation.bind(null, token),
    null,
  );

  if (state?.success) {
    return (
      <div className="space-y-4">
        <FormMessage success={state.success} />
        <Link
          href="/login"
          className={`${buttonClass("primary")} w-full justify-center`}
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
          Choose a password
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

      <FormMessage attempt={state} error={state?.error} />

      <SubmitButton className="w-full">Set password</SubmitButton>
    </form>
  );
}
