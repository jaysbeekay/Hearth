"use client";

import { useActionState } from "react";
import { setupAdmin, type ActionState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { MODULE_REGISTRY } from "@/lib/modules/registry";

export function SetupForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(setupAdmin, null);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1">
        <label htmlFor="name" className="text-sm font-medium">
          Your name
        </label>
        <input
          id="name"
          name="name"
          required
          autoComplete="name"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
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
          autoComplete="email"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="password" className="text-sm font-medium">
          Password
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
        <p className="text-xs text-foreground/60">At least 8 characters.</p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Optional modules</legend>
        <p className="text-xs text-foreground/60">
          Enable any extra modules now, or turn them on later from Settings.
        </p>
        {Object.values(MODULE_REGISTRY).map(({ key, label, description, icon: Icon }) => (
          <label
            key={key}
            className="flex items-start gap-3 rounded-lg border border-border px-3 py-2"
          >
            <input
              type="checkbox"
              name="modules"
              value={key}
              className="mt-0.5 size-4 rounded border-border accent-accent"
            />
            <span>
              <span className="flex items-center gap-2 text-sm font-medium">
                <Icon size={16} />
                {label}
              </span>
              <span className="text-xs text-foreground/60">{description}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <FormMessage error={state?.error} success={state?.success} />

      <SubmitButton className="w-full" pendingText="Creating account…">
        Create admin account
      </SubmitButton>
    </form>
  );
}
