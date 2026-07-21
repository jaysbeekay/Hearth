import type { Metadata } from "next";
import Link from "next/link";
import { Bot } from "lucide-react";
import { auth } from "@/lib/auth";
import { getChatUser, isChatConfigured } from "@/lib/ai/chat/dispatch";
import { listChatThreads, getChatThreadMessages } from "@/lib/chat/threads";
import { AssistantClient } from "@/components/AssistantClient";

export const metadata: Metadata = { title: "Assistant" };

export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string }>;
}) {
  const session = await auth();
  const userId = session!.user.id;
  const { thread: requestedThreadId } = await searchParams;

  const [chatUser, threads] = await Promise.all([getChatUser(userId), listChatThreads(userId)]);

  if (!isChatConfigured(chatUser)) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border p-12 text-center">
        <Bot size={32} className="text-foreground/30" />
        <h1 className="text-lg font-semibold">Assistant not configured</h1>
        <p className="max-w-sm text-sm text-foreground/60">
          Bring your own AI provider key to chat with an assistant that can answer questions
          about your contracts, warranties, trips, vehicles, home, inventory, and wealth.
        </p>
        <Link
          href="/settings"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
        >
          Configure in Settings
        </Link>
      </div>
    );
  }

  const rawMessages = requestedThreadId
    ? await getChatThreadMessages(userId, requestedThreadId)
    : null;
  // Falls back to a fresh conversation if the requested thread doesn't
  // exist or belongs to someone else, rather than letting the client
  // continue posting messages against an id it doesn't own.
  const activeThreadId = rawMessages ? (requestedThreadId ?? null) : null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Assistant</h1>
        <p className="text-sm text-foreground/60">
          Ask about your household data — nothing here is created, edited, or deleted for you.
        </p>
      </div>
      <AssistantClient
        threads={threads}
        activeThreadId={activeThreadId}
        initialMessages={(rawMessages ?? []).map((m) => ({
          id: m.id,
          role: m.role as "USER" | "ASSISTANT",
          content: m.content,
        }))}
      />
    </div>
  );
}
