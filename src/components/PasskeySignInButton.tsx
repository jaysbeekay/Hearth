"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { startAuthentication } from "@simplewebauthn/browser";

export function PasskeySignInButton() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function authenticate() {
    setError(null);
    setPending(true);
    try {
      const optRes = await fetch("/api/auth/passkey/authenticate/options", { method: "POST" });
      if (!optRes.ok) {
        setError("Could not start passkey sign-in. Try again.");
        return;
      }
      const options = await optRes.json();

      let assertion;
      try {
        assertion = await startAuthentication(options);
      } catch (err) {
        if (err instanceof Error && err.name === "NotAllowedError") {
          setError("Sign-in was cancelled.");
        } else {
          setError("Passkey sign-in failed. Try again.");
        }
        return;
      }

      const result = await signIn("passkey", {
        credentialId: assertion.id,
        assertionJSON: JSON.stringify(assertion),
        challenge: options.challenge,
        redirect: false,
      });

      if (result?.ok) {
        window.location.href = "/dashboard";
      } else {
        setError("Passkey sign-in failed. The passkey may not match an account.");
      }
    } catch {
      setError("An unexpected error occurred. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={authenticate}
        disabled={pending}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-border py-2 text-sm font-medium hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-white/5"
      >
        {pending ? (
          "Waiting for passkey…"
        ) : (
          <>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-4"
              aria-hidden
            >
              <circle cx="8" cy="8" r="3" />
              <path d="m14 17-1.5-1.5" />
              <path d="M14 17h7" />
              <path d="m14 17 3 3" />
              <path d="M5.343 14.343A4 4 0 1 1 9.657 18.657" />
            </svg>
            Sign in with passkey
          </>
        )}
      </button>
      {error && <p className="text-center text-sm text-danger">{error}</p>}
    </div>
  );
}
