"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { login, type ActionState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";
import { PasskeySignInButton } from "@/components/PasskeySignInButton";

export function LoginForm({ smtpConfigured = false }: { smtpConfigured?: boolean }) {
  const [state, formAction] = useActionState<ActionState, FormData>(login, null);
  const totpRequired = Boolean(state?.totpRequired);

  // Controlled, rather than relying on the DOM to retain values: a Server
  // Action submission resets uncontrolled form fields even though the page
  // never navigates, which would otherwise wipe email/password between the
  // password step and the follow-up two-factor step.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");

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
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            readOnly={totpRequired}
            autoComplete="email"
            className={`w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent${totpRequired ? " opacity-60" : ""}`}
          />
        </div>

        <div className={totpRequired ? "hidden" : "space-y-1"}>
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
            required={!totpRequired}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>

        {totpRequired && (
          <div className="space-y-1">
            <label htmlFor="totpCode" className="text-sm font-medium">
              Two-factor code
            </label>
            <input
              id="totpCode"
              name="totpCode"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              placeholder="6-digit code or recovery code"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <p className="text-xs text-foreground/50">
              Enter the code from your authenticator app, or one of your recovery codes.
            </p>
          </div>
        )}

        <FormMessage error={state?.error} success={state?.success} />

        <SubmitButton className="w-full">{totpRequired ? "Verify" : "Sign in"}</SubmitButton>
      </form>

      {!totpRequired && (
        <>
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-background px-2 text-foreground/50">or</span>
            </div>
          </div>

          <PasskeySignInButton />
        </>
      )}
    </div>
  );
}
