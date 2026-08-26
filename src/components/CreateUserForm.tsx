"use client";

import { useActionState, useState } from "react";
import { createUser, type ActionState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { SelectWrapper, inputClass, selectClass } from "@/components/SelectWrapper";
import { ROLE_DESCRIPTIONS } from "@/lib/utils";

export function CreateUserForm({ smtpConfigured }: { smtpConfigured: boolean }) {
  const [state, formAction] = useActionState<ActionState, FormData>(createUser, null);
  const [selectedRole, setSelectedRole] = useState(state?.values?.role ?? "MEMBER");

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
            defaultValue={selectedRole}
            onChange={(e) => setSelectedRole(e.target.value)}
            className={selectClass}
          >
            <option value="MEMBER">Member</option>
            <option value="ADMIN">Admin</option>
            <option value="READONLY">Read-only</option>
          </select>
        </SelectWrapper>
        {/* #291 — explains the role at the point of assigning it. */}
        <p className="text-xs text-muted">{ROLE_DESCRIPTIONS[selectedRole]}</p>
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
