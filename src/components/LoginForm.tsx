"use client";

import { useActionState } from "react";
import Link from "next/link";
import { login, type ActionState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { PasskeySignInButton } from "@/components/PasskeySignInButton";

export function LoginForm({ smtpConfigured = false }: { smtpConfigured?: boolean }) {
  const [state, formAction] = useActionState<ActionState, FormData>(login, null);

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-4">
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
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            {smtpConfigured && (
              <Link
                href="/forgot-password"
                className="text-xs text-accent hover:underline"
              >
                Forgot your password?
              </Link>
            )}
          </div>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>

        <FormMessage error={state?.error} success={state?.success} />

        <SubmitButton className="w-full">Sign in</SubmitButton>
      </form>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-background px-2 text-foreground/50">or</span>
        </div>
      </div>

      <PasskeySignInButton />
    </div>
  );
}
