"use client";

import { useState } from "react";
import { readSseStream } from "@/lib/ai/chat/streamParsing";
import type { ProposedAction } from "@/components/ProposedActionCard";
import type { DisplayMessage } from "@/components/ChatMessageList";

type ChatStreamEvent =
  | { type: "delta"; text: string }
  | { type: "tool_call"; name: string }
  | {
      type: "proposed_action";
      id: string;
      entity: "contract" | "product";
      operation: "create" | "update";
      entityId?: string;
      label?: string;
      data: Record<string, unknown>;
      displayValues?: Record<string, string>;
      currentValues?: Record<string, unknown>;
      warnings?: Record<string, string[]>;
    }
  | { type: "error"; message: string }
  | { type: "done"; threadId: string };

// One Assistant conversation: sends to /api/chat, streams the reply into
// `messages`, and tracks the thread the server created. Shared by the full
// Assistant page and the side panel so both behave the same way.
export function useAssistantChat({
  initialThreadId,
  initialMessages,
  onThreadCreated,
  onRecordWritten,
}: {
  initialThreadId: string | null;
  initialMessages: DisplayMessage[];
  /** A first message started a new thread on the server. */
  onThreadCreated?: (threadId: string) => void;
  /** A confirmed proposal wrote a record. */
  onRecordWritten?: () => void;
}) {
  const [threadId, setThreadId] = useState(initialThreadId);
  const [messages, setMessages] = useState<DisplayMessage[]>(initialMessages);
  const [pending, setPending] = useState(false);
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Switch to another thread (or a new one, with null) without a navigation. */
  function load(nextThreadId: string | null, nextMessages: DisplayMessage[]) {
    setThreadId(nextThreadId);
    setMessages(nextMessages);
    setError(null);
    setToolStatus(null);
  }

  async function send(text: string) {
    setError(null);
    setToolStatus(null);
    setMessages((prev) => [...prev, { id: `local-${Date.now()}`, role: "USER", content: text }]);
    const assistantId = `assistant-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: "ASSISTANT", content: "", streaming: true },
    ]);
    setPending(true);

    let sawError = false;
    let newThreadId: string | null = null;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, message: text }),
      });

      // Falls back to the plain-JSON error shape the route still returns
      // for pre-stream failures (auth, invalid input, unconfigured provider).
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("text/event-stream")) {
        const data = (await res.json()) as { threadId?: string; error?: string };
        if (data.error) setError(data.error);
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
        return;
      }

      if (!res.body) throw new Error("No response body");

      await readSseStream(res.body, (data) => {
        let event: ChatStreamEvent;
        try {
          event = JSON.parse(data);
        } catch {
          return;
        }

        if (event.type === "delta") {
          setToolStatus(null);
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + event.text } : m)),
          );
        } else if (event.type === "tool_call") {
          setToolStatus(`Checking ${event.name.replace(/_/g, " ")}…`);
        } else if (event.type === "proposed_action") {
          setToolStatus(null);
          const proposedAction: ProposedAction = {
            id: event.id,
            entity: event.entity,
            operation: event.operation,
            entityId: event.entityId,
            label: event.label,
            data: event.data,
            displayValues: event.displayValues,
            currentValues: event.currentValues,
            warnings: event.warnings,
          };
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, proposedActions: [...(m.proposedActions ?? []), proposedAction] }
                : m,
            ),
          );
        } else if (event.type === "error") {
          sawError = true;
          setError(event.message);
        } else if (event.type === "done") {
          newThreadId = event.threadId;
        }
      });

      if (sawError) {
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      } else {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)),
        );
      }

      if (newThreadId && newThreadId !== threadId) {
        setThreadId(newThreadId);
        onThreadCreated?.(newThreadId);
      }
    } catch {
      setError("Couldn't reach the assistant. Check your connection and try again.");
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    } finally {
      setToolStatus(null);
      setPending(false);
    }
  }

  function resolveAction(
    messageId: string,
    actionId: string,
    result: { success: boolean; message: string },
  ) {
    setMessages((prev) => [
      ...prev.map((m) =>
        m.id === messageId
          ? { ...m, proposedActions: m.proposedActions?.filter((a) => a.id !== actionId) }
          : m,
      ),
      {
        id: `resolution-${actionId}`,
        role: "ASSISTANT",
        content: result.success ? `✅ ${result.message}` : result.message,
      },
    ]);
    if (result.success) onRecordWritten?.();
  }

  return { threadId, messages, pending, toolStatus, error, send, resolveAction, load };
}
