"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MessagesSquare, X } from "lucide-react";
import { ChatThreadList, type ThreadSummary } from "@/components/ChatThreadList";
import { ChatMessageList, type DisplayMessage } from "@/components/ChatMessageList";
import { ChatComposer } from "@/components/ChatComposer";
import { readSseStream } from "@/lib/ai/chat/streamParsing";
import type { ProposedAction } from "@/components/ProposedActionCard";

type ChatStreamEvent =
  | { type: "delta"; text: string }
  | { type: "tool_call"; name: string }
  | {
      type: "proposed_action";
      id: string;
      entity: "contract" | "product";
      operation: "create" | "update";
      entityId?: string;
      data: Record<string, unknown>;
    }
  | { type: "error"; message: string }
  | { type: "done"; threadId: string };

export function AssistantClient({
  threads,
  activeThreadId,
  initialMessages,
}: {
  threads: ThreadSummary[];
  activeThreadId: string | null;
  initialMessages: DisplayMessage[];
}) {
  const router = useRouter();
  const [threadId, setThreadId] = useState(activeThreadId);
  const [messages, setMessages] = useState<DisplayMessage[]>(initialMessages);
  const [pending, setPending] = useState(false);
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The thread sidebar is desktop-only (see the <aside> below) — on mobile
  // there's otherwise no way to reach previous chats at all, not just an
  // unresponsive click (#234). This mirrors DetailOverflowMenu's bottom-sheet
  // pattern for the same "no room for a permanent sidebar" mobile case.
  const [threadsOpen, setThreadsOpen] = useState(false);

  async function handleSend(text: string) {
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
            data: event.data,
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
        router.replace(`/assistant?thread=${newThreadId}`, { scroll: false });
        router.refresh();
      }
    } catch {
      setError("Couldn't reach the assistant. Check your connection and try again.");
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    } finally {
      setToolStatus(null);
      setPending(false);
    }
  }

  function handleActionResolved(
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
    if (result.success) router.refresh();
  }

  return (
    <div className="flex h-[calc(100vh-14rem)] overflow-hidden rounded-xl border border-border bg-surface md:h-[calc(100vh-11rem)]">
      <aside className="hidden w-64 shrink-0 border-r border-border md:block">
        <ChatThreadList threads={threads} activeThreadId={threadId} />
      </aside>
      <div className="flex flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-border px-3 py-2 md:hidden">
          <button
            type="button"
            onClick={() => setThreadsOpen(true)}
            className="flex h-11 items-center gap-2 rounded-lg px-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
          >
            <MessagesSquare size={16} />
            Chats
          </button>
        </div>
        <ChatMessageList
          messages={messages}
          toolStatus={toolStatus}
          onActionResolved={handleActionResolved}
        />
        {error && (
          <p className="border-t border-border bg-danger/10 px-4 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <ChatComposer onSend={handleSend} disabled={pending} />
      </div>

      {threadsOpen && (
        <div
          className="fixed inset-0 z-40 flex items-end bg-black/40 md:hidden"
          onClick={() => setThreadsOpen(false)}
        >
          <div
            role="dialog"
            aria-label="Previous chats"
            aria-modal="true"
            className="max-h-[70vh] w-full overflow-hidden rounded-t-2xl border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-sm font-medium">Chats</span>
              <button
                type="button"
                onClick={() => setThreadsOpen(false)}
                aria-label="Close"
                className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/5"
              >
                <X size={18} />
              </button>
            </div>
            <div className="max-h-[calc(70vh-3rem)] overflow-y-auto">
              <ChatThreadList
                threads={threads}
                activeThreadId={threadId}
                onNavigate={() => setThreadsOpen(false)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
