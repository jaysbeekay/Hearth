"use client";

import { useState, useActionState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { disableTotp, type ActionState } from "@/lib/actions/auth";
import { FormMessage } from "@/components/FormMessage";

type SetupStep = "idle" | "scanning" | "recovery-codes";

export function TotpSection({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<SetupStep>("idle");
  const [qrDataUri, setQrDataUri] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [showDisableForm, setShowDisableForm] = useState(false);

  const [disableState, disableAction] = useActionState<ActionState, FormData>(disableTotp, null);

  function startSetup() {
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/totp/setup", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to start setup.");
        return;
      }
      setQrDataUri(data.qrDataUri);
      setSecret(data.secret);
      setStep("scanning");
    });
  }

  function verifyCode() {
    if (!secret) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/totp/verify-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Invalid code.");
        return;
      }
      setRecoveryCodes(data.recoveryCodes);
      setStep("recovery-codes");
    });
  }

  function cancelSetup() {
    setStep("idle");
    setQrDataUri(null);
    setSecret(null);
    setCode("");
    setError(null);
  }

  function finish() {
    setStep("idle");
    setQrDataUri(null);
    setSecret(null);
    setCode("");
    setRecoveryCodes([]);
    router.refresh();
  }

  if (enabled && !showDisableForm) {
    return (
      <div className="space-y-2">
        <p className="flex items-center gap-2 text-sm">
          <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
            Enabled
          </span>
          Two-factor authentication is protecting your account.
        </p>
        <button
          type="button"
          onClick={() => setShowDisableForm(true)}
          className="text-sm text-danger hover:underline"
        >
          Disable two-factor authentication
        </button>
      </div>
    );
  }

  if (enabled && showDisableForm) {
    return (
      <form action={disableAction} className="space-y-2">
        <label htmlFor="totp-disable-password" className="text-sm font-medium">
          Confirm your password to disable two-factor authentication
        </label>
        <input
          id="totp-disable-password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <div className="flex gap-2">
          <button
            type="submit"
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger/5"
          >
            Disable
          </button>
          <button
            type="button"
            onClick={() => setShowDisableForm(false)}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
          >
            Cancel
          </button>
        </div>
        <FormMessage error={disableState?.error} success={disableState?.success} />
      </form>
    );
  }

  if (step === "scanning") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-foreground/60">
          Scan this QR code with your authenticator app (Google Authenticator, 1Password, Authy,
          etc.), then enter the 6-digit code it shows.
        </p>
        {qrDataUri && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qrDataUri}
            alt="Two-factor authentication QR code"
            className="h-40 w-40 rounded-lg border border-border"
          />
        )}
        {secret && (
          <p className="text-xs text-foreground/50">
            Can&apos;t scan? Enter this code manually: <span className="font-mono">{secret}</span>
          </p>
        )}
        <div className="space-y-1">
          <label htmlFor="totp-setup-code" className="text-sm font-medium">
            6-digit code
          </label>
          <input
            id="totp-setup-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            placeholder="123456"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={pending || code.trim().length === 0}
            onClick={verifyCode}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Verifying…" : "Verify & enable"}
          </button>
          <button
            type="button"
            onClick={cancelSetup}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
          >
            Cancel
          </button>
        </div>
        <FormMessage error={error} />
      </div>
    );
  }

  if (step === "recovery-codes") {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium text-success">
          Two-factor authentication is now enabled.
        </p>
        <p className="text-sm text-foreground/60">
          Save these recovery codes somewhere safe. Each one can be used once to sign in if you
          lose access to your authenticator app. They won&apos;t be shown again.
        </p>
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-background p-3 font-mono text-sm">
          {recoveryCodes.map((c) => (
            <div key={c}>{c}</div>
          ))}
        </div>
        <button
          type="button"
          onClick={finish}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending}
        onClick={startSetup}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Starting…" : "Enable two-factor authentication"}
      </button>
      <FormMessage error={error} />
    </div>
  );
}
