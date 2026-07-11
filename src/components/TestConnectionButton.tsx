"use client";

import { useState, useTransition } from "react";
import type { ActionState } from "@/lib/actions/auth";
import { FormMessage } from "@/components/FormMessage";

const testButtonClass =
  "rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-60 disabled:cursor-not-allowed";

// Uses a plain button (not a nested <form>) since this is meant to render
// inside another section's save <form> — nested forms are invalid HTML and
// cause the browser to submit the wrong one.
export function TestConnectionButton({
  action,
  label,
}: {
  action: () => Promise<ActionState>;
  label: string;
}) {
  const [result, setResult] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(async () => setResult(await action()))}
        className={testButtonClass}
      >
        {pending ? "Testing…" : label}
      </button>
      <FormMessage error={result?.error} success={result?.success} />
    </div>
  );
}
