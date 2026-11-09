"use client";

import { useEffect, useRef, useState } from "react";
import { readChatStream } from "@/lib/assistant/readChatStream";
import type { ProposedAction } from "@/components/ProposedActionCard";
import type { DisplayMessage } from "@/components/ChatMessageList";
import { markReplyStopped } from "@/lib/chat/streamEvents";

const TURN_CUT_OFF_MESSAGE = "The assistant stopped answering unexpectedly. Try again.";

// One Assistant conversation: sends to /api/chat, streams the reply into
// `messages`, and tracks the thread the server created. Shared by the full
// Assistant page and the side panel so both behave the same way.
//
// A reply can be stopped while pending (`stop()`); switching thread and
// unmounting stop it too. A stopped reply keeps the text already streamed,
// marked as stopped, with no error banner; the server saves what it had
// streamed by then, marked the same way.
export function useAssistantChat({
  initialThreadId,
  initialMessages,
  onThreadCreated,
  onThreadListChanged,
  onRecordWritten,
}: {
  initialThreadId: string | null;
  initialMessages: DisplayMessage[];
  /**
   * A first message started a new thread on the server. `stopped` when that
   * reply was stopped: the server may still be saving it.
   */
  onThreadCreated?: (threadId: string, info: { stopped: boolean }) => void;
  /** A thread was created by a request this chat has since moved on from. */
  onThreadListChanged?: () => void;
  /** A confirmed proposal wrote a record. */
  onRecordWritten?: () => void;
}) {
  const [threadId, setThreadId] = useState(initialThreadId);
  const [messages, setMessages] = useState<DisplayMessage[]>(initialMessages);
  const [pending, setPending] = useState(false);
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The in-flight request, if any. A request that is no longer this one was
  // superseded (by load) and must leave the chat state alone.
  const requestRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      requestRef.current?.abort();
    },
    [],
  );

  /** Stop the pending reply, keeping what has streamed so far. */
  function stop() {
    requestRef.current?.abort();
  }

  /** Switch to another thread (or a new one, with null) without a navigation. */
  function load(nextThreadId: string | null, nextMessages: DisplayMessage[]) {
    requestRef.current?.abort();
    requestRef.current = null;
    setPending(false);
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

    requestRef.current?.abort();
    const request = new AbortController();
    requestRef.current = request;
    const isCurrent = () => requestRef.current === request;

    let stopped = false;
    let newThreadId: string | null = null;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, message: text }),
        signal: request.signal,
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

      const outcome = await readChatStream(res.body, (event) => {
        if (event.type === "thread") {
          newThreadId = event.threadId;
        } else if (event.type === "delta") {
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
        }
      });

      if (!isCurrent()) return;
      if (outcome.kind === "done") {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)),
        );
      } else if (request.signal.aborted) {
        stopped = true;
      } else {
        // An error event, or a stream that ended without finishing the turn.
        setError(outcome.kind === "error" ? outcome.message : TURN_CUT_OFF_MESSAGE);
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      }
    } catch {
      if (!isCurrent()) return;
      if (request.signal.aborted) {
        stopped = true;
      } else {
        setError("Couldn't reach the assistant. Check your connection and try again.");
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      }
    } finally {
      if (isCurrent()) {
        requestRef.current = null;
        if (stopped) {
          // Keep what streamed, marked as stopped; drop an empty reply.
          setMessages((prev) =>
            prev.flatMap((m) => {
              if (m.id !== assistantId) return [m];
              if (!m.content.trim()) return [];
              return [{ ...m, content: markReplyStopped(m.content), streaming: false }];
            }),
          );
        }
        setToolStatus(null);
        setPending(false);
        if (newThreadId && newThreadId !== threadId) {
          setThreadId(newThreadId);
          onThreadCreated?.(newThreadId, { stopped });
        }
      } else if (newThreadId && newThreadId !== threadId) {
        // Superseded (new chat, or another chat opened) after the server had
        // already created a thread for this message: it exists, so list it.
        onThreadListChanged?.();
      }
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

  return { threadId, messages, pending, toolStatus, error, send, stop, resolveAction, load };
}
