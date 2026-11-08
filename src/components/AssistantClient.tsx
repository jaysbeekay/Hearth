"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MessagesSquare, X } from "lucide-react";
import { ChatThreadList, type ThreadSummary } from "@/components/ChatThreadList";
import { ChatMessageList, type DisplayMessage } from "@/components/ChatMessageList";
import { ChatComposer } from "@/components/ChatComposer";
import { useAssistantChat } from "@/lib/assistant/useAssistantChat";
import { Card } from "@/components/ui/Card";
import { sheetClass, buttonClass } from "@/lib/ui";

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
  const { threadId, messages, pending, toolStatus, error, send, resolveAction } = useAssistantChat({
    initialThreadId: activeThreadId,
    initialMessages,
    onThreadCreated: (id) => {
      router.replace(`/assistant?thread=${id}`, { scroll: false });
      router.refresh();
    },
    onRecordWritten: () => router.refresh(),
  });
  // The thread sidebar is desktop-only (see the <aside> below) — on mobile
  // there's otherwise no way to reach previous chats at all, not just an
  // unresponsive click (#234). This mirrors DetailOverflowMenu's bottom-sheet
  // pattern for the same "no room for a permanent sidebar" mobile case.
  const [threadsOpen, setThreadsOpen] = useState(false);

  return (
    <Card padding="none" className="flex h-[calc(100vh-14rem)] overflow-hidden md:h-[calc(100vh-11rem)]">
      <aside className="hidden w-64 shrink-0 border-r border-border md:block">
        <ChatThreadList threads={threads} activeThreadId={threadId} />
      </aside>
      <div className="flex flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-border px-3 py-2 md:hidden">
          <button
            type="button"
            onClick={() => setThreadsOpen(true)}
            className={buttonClass("quiet")}
          >
            <MessagesSquare size={16} />
            Chats
          </button>
        </div>
        <ChatMessageList
          messages={messages}
          toolStatus={toolStatus}
          onActionResolved={resolveAction}
        />
        {error && (
          <p className="border-t border-border bg-danger/10 px-4 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <ChatComposer onSend={send} disabled={pending} />
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
            className={sheetClass("max-h-[70vh] overflow-hidden pb-[env(safe-area-inset-bottom)]")}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-sm font-medium">Chats</span>
              <button
                type="button"
                onClick={() => setThreadsOpen(false)}
                aria-label="Close"
                className={buttonClass("quiet", { icon: true })}
              >
                <X size={20} />
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
    </Card>
  );
}
