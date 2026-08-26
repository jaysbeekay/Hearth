"use client";

import { useActionState } from "react";
import { createUser, type ActionState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { SelectWrapper, inputClass, selectClass } from "@/components/SelectWrapper";

export function CreateUserForm({ smtpConfigured }: { smtpConfigured: boolean }) {
  const [state, formAction] = useActionState<ActionState, FormData>(createUser, null);

  return (
    <form action={formAction} className="grid gap-3 md:grid-cols-2">
      <div className="space-y-1">
        <label htmlFor="name" className="text-sm font-medium">
          Name
        </label>
        <input
          id="name"
          name="name"
          required
          defaultValue={state?.values?.name}
          className={inputClass}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          defaultValue={state?.values?.email}
          className={inputClass}
        />
      </div>
      {!smtpConfigured && (
        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium">
            Temporary password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            className={inputClass}
          />
        </div>
      )}
      <div className="space-y-1">
        <label htmlFor="role" className="text-sm font-medium">
          Role
        </label>
        <SelectWrapper>
          <select
            id="role"
            name="role"
            defaultValue={state?.values?.role ?? "MEMBER"}
            className={selectClass}
          >
            <option value="MEMBER">Member</option>
            <option value="ADMIN">Admin</option>
            <option value="READONLY">Read-only</option>
          </select>
        </SelectWrapper>
      </div>
      {smtpConfigured && (
        <p className="md:col-span-2 text-xs text-muted">
          An invitation email will be sent so they can set their own password.
        </p>
      )}
      <div className="md:col-span-2">
        <FormMessage error={state?.error} success={state?.success} />
      </div>
      <div className="md:col-span-2">
        <SubmitButton>{smtpConfigured ? "Send invitation" : "Add household member"}</SubmitButton>
      </div>
    </form>
  );
}
