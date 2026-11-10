"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { scrollBehavior } from "@/lib/reducedMotion";
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
  const listRef = useRef<HTMLDivElement>(null);

  // Scrolls this list only: scrollIntoView would also scroll the page behind
  // the side panel. Instant under reduced motion (#617).
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: scrollBehavior() });
  }, [messages, toolStatus]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted">
        <p>Ask about your contracts, warranties, trips, vehicles, properties, inventory, or wealth.</p>
      </div>
    );
  }

  return (
    <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto p-4">
      {messages.map((message) => (
        <div
          key={message.id}
          className={cn("flex gap-3", message.role === "USER" && "flex-row-reverse")}
        >
          <div className="max-w-[85%]">
            <div
              className={cn(
                "whitespace-pre-wrap rounded-lg px-3 py-2 text-sm",
                message.role === "USER"
                  ? "bg-accent text-accent-foreground"
                  : "bg-muted/10",
                message.streaming && !message.content && "text-muted",
              )}
            >
              {message.streaming && !message.content
                ? (toolStatus ?? "Thinking…")
                : message.content}
              {message.streaming && message.content && (
                <span className="ml-0.5 inline-block w-1.5 animate-pulse motion-reduce:animate-none">▍</span>
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
    </div>
  );
}
