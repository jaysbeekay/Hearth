import { redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { Bot } from "lucide-react";
import { auth } from "@/lib/auth";
import { getChatConfig, isChatConfigured } from "@/lib/ai/chat/dispatch";
import { listChatThreads, getChatThreadMessages } from "@/lib/chat/threads";
import { AssistantClient } from "@/components/AssistantClient";

export const metadata: Metadata = { title: "Assistant" };

export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string }>;
}) {
  const session = await auth();
  // auth() can now return null mid-render — a session is revoked as soon as
  // the account's sessionVersion moves (password/role change) or the account
  // is deleted, which the proxy won't have caught for an in-flight request.
  if (!session?.user) redirect("/login");

  const userId = session.user.id;
  const { thread: requestedThreadId } = await searchParams;

  const [chatUser, threads] = await Promise.all([getChatConfig(), listChatThreads(userId)]);

  if (!isChatConfigured(chatUser)) {
    const isAdmin = session.user.role === "ADMIN";
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border p-12 text-center">
        <Bot size={32} className="text-foreground/30" />
        <h1 className="text-lg font-semibold">Assistant not configured</h1>
        <p className="max-w-sm text-sm text-muted">
          {isAdmin
            ? "Bring your own AI provider key to enable an assistant that can answer questions about your household's contracts, warranties, trips, vehicles, home, inventory, and wealth."
            : "Ask a household admin to configure an AI provider so the assistant can answer questions about your household's data."}
        </p>
        {isAdmin && (
          <Link
            href="/settings/app"
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
          >
            Configure in System settings
          </Link>
        )}
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
        <p className="text-sm text-muted">
          Ask about your household data — it can also propose creating or updating a contract or
          product, but nothing is written without your explicit confirmation first.
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
