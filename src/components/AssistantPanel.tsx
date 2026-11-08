"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Bot, Maximize2, PanelRightClose, Plus } from "lucide-react";
import { ChatMessageList } from "@/components/ChatMessageList";
import { ChatComposer } from "@/components/ChatComposer";
import type { ThreadSummary } from "@/components/ChatThreadList";
import { SelectWrapper, selectClass } from "@/components/SelectWrapper";
import { loadAssistantThread, loadAssistantThreads } from "@/lib/actions/assistantPanel";
import { useAssistantChat } from "@/lib/assistant/useAssistantChat";
import { ASSISTANT_PANEL_COOKIE } from "@/lib/assistant/panelCookie";
import { buttonClass } from "@/lib/ui";

function rememberOpen(open: boolean) {
  // A cookie rather than localStorage so the layout renders the panel in the
  // right state on the server, with no flash on load.
  document.cookie = `${ASSISTANT_PANEL_COOKIE}=${open ? "open" : "closed"}; path=/; max-age=31536000; samesite=lax`;
}

// The assistant docked on the right of every page (wide screens only; phones
// and narrower windows use the Assistant page). Mounted by the app layout
// only when the household has the assistant on and a provider saved.
export function AssistantPanel({ initialOpen }: { initialOpen: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(initialOpen);
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [switching, setSwitching] = useState(false);

  const chat = useAssistantChat({
    initialThreadId: null,
    initialMessages: [],
    onThreadCreated: () => {
      void loadAssistantThreads().then(setThreads);
    },
    onRecordWritten: () => router.refresh(),
  });

  const onAssistantPage = pathname === "/assistant";
  const { threadId: activeThreadId, load: loadChat } = chat;

  // Reload the chat list whenever the panel shows again (opened, or back from
  // the Assistant page), so chats started or deleted there are picked up. If
  // the open chat was deleted meanwhile, start a new one rather than sending
  // into a thread that no longer exists.
  useEffect(() => {
    if (!open || onAssistantPage) return;
    let cancelled = false;
    void loadAssistantThreads().then((list) => {
      if (cancelled) return;
      setThreads(list);
      if (activeThreadId && !list.some((t) => t.id === activeThreadId)) loadChat(null, []);
    });
    return () => {
      cancelled = true;
    };
    // activeThreadId is read at reload time only; a chat the panel just
    // created refreshes the list itself (onThreadCreated).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onAssistantPage]);

  // Toasts sit bottom-right; while the panel is open they move clear of its
  // composer (see .toast-stack in globals.css).
  useEffect(() => {
    const root = document.documentElement;
    if (open && !onAssistantPage) root.dataset.assistantPanel = "open";
    else delete root.dataset.assistantPanel;
    return () => {
      delete root.dataset.assistantPanel;
    };
  }, [open, onAssistantPage]);

  // The full Assistant page is already the same chat.
  if (onAssistantPage) return null;

  function toggle(next: boolean) {
    setOpen(next);
    rememberOpen(next);
  }

  async function openThread(id: string) {
    if (!id) {
      chat.load(null, []);
      return;
    }
    setSwitching(true);
    try {
      const messages = await loadAssistantThread(id);
      if (messages) chat.load(id, messages);
    } finally {
      setSwitching(false);
    }
  }

  // Closed, it's a narrow rail in the page flow rather than a floating
  // button, so it never covers page actions or toasts.
  if (!open) {
    return (
      <div className="sticky top-0 hidden h-screen w-12 shrink-0 self-start flex-col items-center border-l border-border bg-surface py-4 xl:flex">
        <button
          type="button"
          onClick={() => toggle(true)}
          aria-label="Open assistant panel"
          title="Assistant"
          className={buttonClass("quiet", { icon: true }, "text-accent")}
        >
          <Bot size={20} />
        </button>
      </div>
    );
  }

  return (
    <aside
      aria-label="Assistant"
      className="sticky top-0 hidden h-screen self-start w-[380px] shrink-0 flex-col border-l border-border bg-surface xl:flex"
    >
      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        <Bot size={16} className="shrink-0 text-accent" />
        <span className="mr-auto text-sm font-medium">Assistant</span>
        <button
          type="button"
          onClick={() => void openThread("")}
          disabled={chat.pending || switching}
          aria-label="New chat"
          title="New chat"
          className={buttonClass("quiet", { icon: true })}
        >
          <Plus size={16} />
        </button>
        <Link
          href={chat.threadId ? `/assistant?thread=${chat.threadId}` : "/assistant"}
          aria-label="Open full Assistant page"
          title="Open full page"
          className={buttonClass("quiet", { icon: true })}
        >
          <Maximize2 size={16} />
        </Link>
        <button
          type="button"
          onClick={() => toggle(false)}
          aria-label="Close assistant panel"
          title="Close"
          className={buttonClass("quiet", { icon: true })}
        >
          <PanelRightClose size={16} />
        </button>
      </div>

      {threads && threads.length > 0 && (
        <div className="border-b border-border px-3 py-2">
          <label htmlFor="assistantPanelThread" className="sr-only">
            Previous chats
          </label>
          <SelectWrapper>
            <select
              id="assistantPanelThread"
              value={chat.threadId ?? ""}
              disabled={switching || chat.pending}
              onChange={(e) => void openThread(e.target.value)}
              className={selectClass}
            >
              <option value="">New chat</option>
              {threads.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title || "New conversation"}
                </option>
              ))}
            </select>
          </SelectWrapper>
          {/* #285 — chats are the one thing not shared with the household. */}
          <p className="mt-1 text-xs text-muted">Private to you.</p>
        </div>
      )}

      <ChatMessageList
        messages={chat.messages}
        toolStatus={chat.toolStatus}
        onActionResolved={chat.resolveAction}
      />
      {chat.error && (
        <p className="border-t border-border bg-danger/10 px-4 py-2 text-sm text-danger">
          {chat.error}
        </p>
      )}
      <ChatComposer onSend={chat.send} disabled={chat.pending || switching} />
    </aside>
  );
}
