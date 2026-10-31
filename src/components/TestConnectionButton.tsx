"use client";

import { useState, useTransition } from "react";
import type { ActionState } from "@/lib/actions/auth";
import { FormMessage } from "@/components/FormMessage";
import { buttonClass } from "@/lib/ui";

const testButtonClass = buttonClass("secondary");

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
