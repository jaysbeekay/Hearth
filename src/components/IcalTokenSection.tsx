"use client";

import { useActionState, useRef } from "react";
import { generateIcalToken, revokeIcalToken, type IcalActionState } from "@/lib/actions/ical";
import { FormMessage } from "@/components/FormMessage";
import { SubmitButton } from "@/components/SubmitButton";
import { compactButtonClass } from "@/lib/buttonStyles";

interface Props {
  // Whether a feed is currently active. The token itself is stored only as a
  // hash, so the server can't send it back — the URL exists client-side just
  // once, in the response to the generate action below.
  hasToken: boolean;
  appUrl: string;
}

export function IcalTokenSection({ hasToken, appUrl }: Props) {
  const [genState, genAction] = useActionState<IcalActionState, FormData>(generateIcalToken, null);
  const [revokeState, revokeAction] = useActionState<IcalActionState, FormData>(
    revokeIcalToken,
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);

  const justGenerated = genState?.token
    ? `${appUrl}/api/ical?token=${genState.token}`
    : null;
  const active = hasToken && !revokeState?.success;

  function copy() {
    if (inputRef.current) {
      navigator.clipboard.writeText(inputRef.current.value).catch(() => {});
    }
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
      <h2 className="mb-1 font-medium">Calendar feed</h2>
      <p className="mb-3 text-sm text-muted">
        Subscribe to your household&apos;s contracts, warranties, and events in any calendar app
        that supports iCal (Apple Calendar, Google Calendar, Outlook, etc.).
      </p>

      {justGenerated && (
        <div className="mb-3 space-y-2">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              readOnly
              value={justGenerated}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none"
            />
            <button type="button" onClick={copy} className={`shrink-0 ${compactButtonClass()}`}>
              Copy
            </button>
          </div>
          <p className="text-xs text-muted">
            Anyone with this URL can read your household&apos;s calendar, so treat it like a
            password. It isn&apos;t stored in a readable form and won&apos;t be shown again —
            generate a new one if you lose it.
          </p>
        </div>
      )}

      {active && !justGenerated && (
        <p className="mb-3 text-sm text-muted">
          A calendar feed is active. Its URL isn&apos;t stored and can&apos;t be shown again —
          generate a new one to get a fresh URL, which replaces the old one.
        </p>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <form action={genAction}>
            <SubmitButton pendingText="Generating…">
              {active ? "Generate new URL" : "Create calendar feed"}
            </SubmitButton>
          </form>
          {active && (
            <form action={revokeAction}>
              <button type="submit" className={compactButtonClass("danger")}>
                Revoke feed
              </button>
            </form>
          )}
        </div>
        <FormMessage error={genState?.error} success={justGenerated ? undefined : genState?.success} />
        <FormMessage error={revokeState?.error} success={revokeState?.success} />
      </div>
    </section>
  );
}
