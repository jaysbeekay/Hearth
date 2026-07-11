"use client";

import { useActionState } from "react";
import { updateMemberRole, type ActionState } from "@/lib/actions/auth";
import { SelectWrapper, selectClass } from "@/components/SelectWrapper";
import { FormMessage } from "@/components/FormMessage";

export function MemberRoleForm({ userId, role }: { userId: string; role: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    updateMemberRole.bind(null, userId),
    null,
  );

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction} className="flex items-center gap-2">
        <SelectWrapper>
          <select
            name="role"
            defaultValue={role}
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
      <FormMessage error={state?.error} success={state?.success} />
    </div>
  );
}
