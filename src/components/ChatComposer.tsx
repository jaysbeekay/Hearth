"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Square } from "lucide-react";
import { buttonClass, textareaClass } from "@/lib/ui";
import { cn } from "@/lib/utils";

// While a reply is pending, Stop takes Send's place.
export function ChatComposer({
  onSend,
  onStop,
  pending,
  disabled = false,
}: {
  onSend: (text: string) => void;
  onStop: () => void;
  pending: boolean;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Stop swaps itself for Send, so put focus back in the box once the reply
  // has stopped, ready for the next message.
  const refocusAfterStop = useRef(false);

  useEffect(() => {
    if (pending || !refocusAfterStop.current) return;
    refocusAfterStop.current = false;
    textareaRef.current?.focus();
  }, [pending]);

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || disabled || pending) return;
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
        ref={textareaRef}
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
        disabled={disabled || pending}
        className={cn(textareaClass, "max-h-40 flex-1 resize-none")}
      />
      {pending ? (
        <button
          type="button"
          onClick={() => {
            refocusAfterStop.current = true;
            onStop();
          }}
          className={buttonClass("secondary", { icon: true })}
          aria-label="Stop"
          title="Stop"
        >
          <Square size={16} fill="currentColor" />
        </button>
      ) : (
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          className={buttonClass("primary", { icon: true })}
          aria-label="Send"
        >
          <Send size={16} />
        </button>
      )}
    </form>
  );
}
