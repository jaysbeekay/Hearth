"use client";

import { useState } from "react";
import { Send } from "lucide-react";

export function ChatComposer({
  onSend,
  disabled,
}: {
  onSend: (text: string) => void;
  disabled: boolean;
}) {
  const [value, setValue] = useState("");

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex items-end gap-2 border-t border-border p-3"
    >
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        rows={1}
        placeholder="Ask about your household data…"
        disabled={disabled}
        className="max-h-40 flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground hover:opacity-90 disabled:opacity-50"
        aria-label="Send"
      >
        <Send size={16} />
      </button>
    </form>
  );
}
