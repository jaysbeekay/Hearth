"use client";

import { useActionState, useRef } from "react";
import { generateIcalToken, revokeIcalToken } from "@/lib/actions/ical";
import { FormMessage } from "@/components/FormMessage";
import type { ActionState } from "@/lib/actions/auth";

interface Props {
  token: string | null;
  appUrl: string;
}

export function IcalTokenSection({ token, appUrl }: Props) {
  const [genState, genAction] = useActionState<ActionState, FormData>(generateIcalToken, null);
  const [revokeState, revokeAction] = useActionState<ActionState, FormData>(revokeIcalToken, null);
  const inputRef = useRef<HTMLInputElement>(null);

  const feedUrl = token ? `${appUrl}/api/ical?token=${token}` : null;

  function copy() {
    if (inputRef.current) {
      navigator.clipboard.writeText(inputRef.current.value).catch(() => {});
    }
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
      <h2 className="mb-1 font-medium">iCal feed</h2>
      <p className="mb-3 text-sm text-foreground/60">
        Subscribe to your contracts, products, and events in any calendar app that supports iCal
        (Apple Calendar, Google Calendar, Outlook, etc.).
      </p>

      {feedUrl ? (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              readOnly
              value={feedUrl}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none"
            />
            <button
              type="button"
              onClick={copy}
              className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5"
            >
              Copy
            </button>
          </div>
          <form action={revokeAction}>
            <button
              type="submit"
              className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger/5"
            >
              Revoke token
            </button>
          </form>
          <FormMessage error={revokeState?.error} success={revokeState?.success} />
        </div>
      ) : (
        <div className="space-y-2">
          <form action={genAction}>
            <button
              type="submit"
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
            >
              Generate iCal token
            </button>
          </form>
          <FormMessage error={genState?.error} success={genState?.success} />
        </div>
      )}
    </section>
  );
}
