"use client";

import { useActionState, useState } from "react";
import { updateMemberRole, type ActionState } from "@/lib/actions/auth";
import { SelectWrapper, selectClass } from "@/components/SelectWrapper";
import { FormMessage } from "@/components/FormMessage";
import { ROLE_DESCRIPTIONS } from "@/lib/utils";

export function MemberRoleForm({ userId, role }: { userId: string; role: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    updateMemberRole.bind(null, userId),
    null,
  );
  const [selectedRole, setSelectedRole] = useState(role);

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction} className="flex items-center gap-2">
        <SelectWrapper>
          <select
            name="role"
            defaultValue={role}
            onChange={(e) => setSelectedRole(e.target.value)}
            className={`${selectClass} h-8 py-0 text-xs`}
          >
            <option value="MEMBER">Member</option>
            <option value="ADMIN">Admin</option>
            <option value="READONLY">Read-only</option>
          </select>
        </SelectWrapper>
        <button
          type="submit"
          className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5"
        >
          Save
        </button>
      </form>
      {/* #291 — explains the role at the point of changing it, not just its name. */}
      <p className="max-w-48 text-right text-xs text-muted">{ROLE_DESCRIPTIONS[selectedRole]}</p>
      <FormMessage error={state?.error} success={state?.success} />
    </div>
  );
}
