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
  inRow = false,
}: {
  action: () => Promise<ActionState>;
  label: string;
  /**
   * Set when it sits in a SETTINGS_ACTION_ROW beside a Save button: the
   * result then gets a full-width row of its own underneath both buttons.
   */
  inRow?: boolean;
}) {
  const [result, setResult] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();

  const message = <FormMessage attempt={result} error={result?.error} success={result?.success} />;
  if (inRow) {
    // A long result (an SMTP server's full rejection) used to sit beside the
    // Save button and run into it; here it spans the row below instead.
    return (
      <>
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(async () => setResult(await action()))}
          className={`${testButtonClass} justify-self-start`}
        >
          {pending ? "Testing…" : label}
        </button>
        {result && <div className="col-span-full row-start-2 min-w-0 break-words">{message}</div>}
      </>
    );
  }

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
      {message}
    </div>
  );
}
