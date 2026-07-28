"use client";

import { useEffect, useRef } from "react";
import { Bot, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProposedActionCard, type ProposedAction } from "@/components/ProposedActionCard";

export interface DisplayMessage {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  // True while this message's text is still arriving via the SSE stream —
  // shows a "Thinking…" placeholder until the first chunk lands, then a
  // blinking cursor after the growing text.
  streaming?: boolean;
  // A guarded write the assistant proposed during this turn — rendered as a
  // confirm/cancel card; nothing is written until the user confirms it.
  proposedActions?: ProposedAction[];
}

export function ChatMessageList({
  messages,
  toolStatus,
  onActionResolved,
}: {
  messages: DisplayMessage[];
  toolStatus: string | null;
  onActionResolved: (messageId: string, actionId: string, result: { success: boolean; message: string }) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, toolStatus]);

  if (messages.length === 0) {
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
          <div className="max-w-[85%]">
            <div
              className={cn(
                "whitespace-pre-wrap rounded-xl px-3 py-2 text-sm",
                message.role === "USER"
                  ? "bg-accent text-accent-foreground"
                  : "bg-black/5 dark:bg-white/10",
                message.streaming && !message.content && "text-foreground/50",
              )}
            >
              {message.streaming && !message.content
                ? (toolStatus ?? "Thinking…")
                : message.content}
              {message.streaming && message.content && (
                <span className="ml-0.5 inline-block w-1.5 animate-pulse">▍</span>
              )}
            </div>
            {message.proposedActions?.map((action) => (
              <ProposedActionCard
                key={action.id}
                action={action}
                onResolved={(result) => onActionResolved(message.id, action.id, result)}
              />
            ))}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
