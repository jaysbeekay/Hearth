"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { buttonClass, textareaClass } from "@/lib/ui";
import { cn } from "@/lib/utils";

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
        className={cn(textareaClass, "max-h-40 flex-1 resize-none")}
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        className={buttonClass("primary", { icon: true })}
        aria-label="Send"
      >
        <Send size={16} />
      </button>
    </form>
  );
}
