"use client";

import { useActionState } from "react";
import { FileText } from "lucide-react";
import { setupAdmin, type ActionState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { inputClass } from "@/components/SelectWrapper";
import { MODULE_REGISTRY, type ModuleKey } from "@/lib/modules/registry";

// Setup-screen-only ordering: Travel last, since it's the module most new
// households defer. Doesn't touch MODULE_REGISTRY's own order, which also
// drives nav grouping and the Settings > Modules list.
const SETUP_MODULE_ORDER: ModuleKey[] = ["HOME", "VEHICLES", "INVENTORY", "WEALTH", "TRAVEL"];

export function SetupForm({ setupTokenRequired = false }: { setupTokenRequired?: boolean }) {
  const [state, formAction] = useActionState<ActionState, FormData>(setupAdmin, null);

  return (
    <form action={formAction} className="space-y-4">
      {setupTokenRequired && (
        <div className="space-y-1">
          <label htmlFor="setupToken" className="text-sm font-medium">
            Setup token
          </label>
          <input
            id="setupToken"
            name="setupToken"
            type="password"
            required
            autoComplete="off"
            className={inputClass}
          />
          <p className="text-xs text-foreground/60">
            The value of SETUP_TOKEN from your server&apos;s environment.
          </p>
        </div>
      )}

      <div className="space-y-1">
        <label htmlFor="name" className="text-sm font-medium">
          Your name
        </label>
        <input
          id="name"
          name="name"
          required
          autoComplete="name"
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
          autoComplete="email"
          className={inputClass}
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
          className={inputClass}
        />
        <p className="text-xs text-foreground/60">At least 8 characters.</p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">What would you like to track?</legend>
        <p className="text-xs text-foreground/60">
          Enable any extra modules now, or turn them on later from Settings. Records in every
          module are visible to your whole household, not just the person who added them.
        </p>
        <label className="flex items-start gap-3 rounded-lg border border-border px-3 py-2 opacity-70">
          <input
            type="checkbox"
            checked
            disabled
            aria-label="Document management (always enabled)"
            className="mt-0.5 size-4 rounded border-border accent-accent"
          />
          <span>
            <span className="flex items-center gap-2 text-sm font-medium">
              <FileText size={16} />
              Document management
            </span>
            <span className="text-xs text-foreground/60">
              Contracts, warranties, and documents are always included — not optional.
            </span>
          </span>
        </label>
        {SETUP_MODULE_ORDER.map((key) => {
          const { label, description, icon: Icon } = MODULE_REGISTRY[key];
          return (
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
          );
        })}
      </fieldset>

      <FormMessage error={state?.error} success={state?.success} />

      <SubmitButton className="w-full" pendingText="Creating account…">
        Create admin account
      </SubmitButton>
    </form>
  );
}
