"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChatThreadList, type ThreadSummary } from "@/components/ChatThreadList";
import { ChatMessageList, type DisplayMessage } from "@/components/ChatMessageList";
import { ChatComposer } from "@/components/ChatComposer";

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
  const [error, setError] = useState<string | null>(null);

  async function handleSend(text: string) {
    setError(null);
    setMessages((prev) => [...prev, { id: `local-${Date.now()}`, role: "USER", content: text }]);
    setPending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, message: text }),
      });
      const data = (await res.json()) as { threadId?: string; message?: string; error?: string };

      if (data.error) {
        setError(data.error);
      } else if (data.message) {
        setMessages((prev) => [
          ...prev,
          { id: `assistant-${Date.now()}`, role: "ASSISTANT", content: data.message! },
        ]);
      }

      if (data.threadId && data.threadId !== threadId) {
        setThreadId(data.threadId);
        router.replace(`/assistant?thread=${data.threadId}`, { scroll: false });
        router.refresh();
      }
    } catch {
      setError("Couldn't reach the assistant. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-14rem)] overflow-hidden rounded-xl border border-border bg-surface md:h-[calc(100vh-11rem)]">
      <aside className="hidden w-64 shrink-0 border-r border-border md:block">
        <ChatThreadList threads={threads} activeThreadId={threadId} />
      </aside>
      <div className="flex flex-1 flex-col">
        <ChatMessageList messages={messages} pending={pending} />
        {error && (
          <p className="border-t border-border bg-danger/10 px-4 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <ChatComposer onSend={handleSend} disabled={pending} />
      </div>
    </div>
  );
}
