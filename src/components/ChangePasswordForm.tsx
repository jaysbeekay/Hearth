"use client";

import { useActionState } from "react";
import { changePassword, type ActionState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { inputClass } from "@/components/SelectWrapper";

export function ChangePasswordForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(changePassword, null);

  return (
    <form action={formAction} className="space-y-3">
      <div className="space-y-1">
        <label htmlFor="currentPassword" className="text-sm font-medium">
          Current password
        </label>
        <input
          id="currentPassword"
          name="currentPassword"
          type="password"
          required
          autoComplete="current-password"
          className={inputClass}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="newPassword" className="text-sm font-medium">
          New password
        </label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={inputClass}
        />
      </div>
      <FormMessage error={state?.error} success={state?.success} />
      <SubmitButton>Update password</SubmitButton>
    </form>
  );
}
