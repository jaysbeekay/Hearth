"use client";

import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { ConfirmForm } from "@/components/ConfirmForm";
import { deleteChatThread } from "@/lib/actions/chatThreads";
import { cn } from "@/lib/utils";

export interface ThreadSummary {
  id: string;
  title: string | null;
  updatedAt: Date;
}

export function ChatThreadList({
  threads,
  activeThreadId,
}: {
  threads: ThreadSummary[];
  activeThreadId: string | null;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <Link
          href="/assistant"
          className="flex items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
        >
          <Plus size={16} />
          New chat
        </Link>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-3">
        {threads.length === 0 && (
          <p className="px-2 text-xs text-foreground/50">No conversations yet.</p>
        )}
        {threads.map((thread) => (
          <div
            key={thread.id}
            className={cn(
              "group flex items-center gap-1 rounded-lg px-2 py-2 text-sm",
              thread.id === activeThreadId
                ? "bg-accent/10 text-accent"
                : "hover:bg-black/5 dark:hover:bg-white/5",
            )}
          >
            <Link href={`/assistant?thread=${thread.id}`} className="flex-1 truncate">
              {thread.title || "New conversation"}
            </Link>
            <ConfirmForm
              action={() => deleteChatThread(thread.id)}
              confirmText="Delete this conversation? This can't be undone."
              ariaLabel="Delete conversation"
              successMessage=""
              className="shrink-0 rounded-md p-1 text-foreground/40 opacity-0 hover:text-danger group-hover:opacity-100"
            >
              <Trash2 size={14} />
            </ConfirmForm>
          </div>
        ))}
      </nav>
    </div>
  );
}
