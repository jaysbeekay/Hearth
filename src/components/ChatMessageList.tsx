"use client";

import { useEffect, useRef } from "react";
import { Bot, User } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DisplayMessage {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
}

export function ChatMessageList({
  messages,
  pending,
}: {
  messages: DisplayMessage[];
  pending: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

  if (messages.length === 0 && !pending) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-foreground/50">
        <Bot size={28} className="text-foreground/30" />
        <p>Ask about your contracts, warranties, trips, vehicles, home, inventory, or wealth.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-4 overflow-y-auto p-4">
      {messages.map((message) => (
        <div
          key={message.id}
          className={cn("flex gap-3", message.role === "USER" && "flex-row-reverse")}
        >
          <div
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-full",
              message.role === "USER"
                ? "bg-accent text-accent-foreground"
                : "bg-black/5 dark:bg-white/10",
            )}
          >
            {message.role === "USER" ? <User size={14} /> : <Bot size={14} />}
          </div>
          <div
            className={cn(
              "max-w-[75%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm",
              message.role === "USER"
                ? "bg-accent text-accent-foreground"
                : "bg-black/5 dark:bg-white/10",
            )}
          >
            {message.content}
          </div>
        </div>
      ))}
      {pending && (
        <div className="flex gap-3">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-black/5 dark:bg-white/10">
            <Bot size={14} />
          </div>
          <div className="rounded-xl bg-black/5 px-3 py-2 text-sm text-foreground/50 dark:bg-white/10">
            Thinking…
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
