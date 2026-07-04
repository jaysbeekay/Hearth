"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startRegistration } from "@simplewebauthn/browser";

export function PasskeyRegisterButton() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function register() {
    setError(null);
    setPending(true);
    try {
      const optRes = await fetch("/api/auth/passkey/register/options", { method: "POST" });
      if (!optRes.ok) {
        const body = await optRes.json().catch(() => ({}));
        setError(body.error ?? "Failed to start registration.");
        return;
      }
      const options = await optRes.json();

      let attestation;
      try {
        attestation = await startRegistration(options);
      } catch (err) {
        if (err instanceof Error && err.name === "NotAllowedError") {
          setError("Registration was cancelled.");
        } else {
          setError("Passkey registration failed. Try again.");
        }
        return;
      }

      const nicknameInput = document.getElementById("passkey-nickname") as HTMLInputElement | null;
      const nickname = nicknameInput?.value?.trim() || undefined;

      const verRes = await fetch("/api/auth/passkey/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: attestation, nickname }),
      });
      const verBody = await verRes.json().catch(() => ({}));

      if (!verRes.ok || !verBody.verified) {
        setError(verBody.error ?? "Verification failed.");
        return;
      }

      router.refresh();
    } catch {
      setError("An unexpected error occurred. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          id="passkey-nickname"
          type="text"
          placeholder="Nickname (e.g. MacBook Touch ID)"
          maxLength={100}
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={register}
          disabled={pending}
          className="inline-flex items-center justify-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Registering…" : "Add passkey"}
        </button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
