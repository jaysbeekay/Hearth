"use server";

import { auth } from "@/lib/auth";
import { isAssistantEnabled } from "@/lib/assistant/enablement";
import { getChatThreadMessages, listChatThreads } from "@/lib/chat/threads";
import type { ThreadSummary } from "@/components/ChatThreadList";
import type { DisplayMessage } from "@/components/ChatMessageList";

// Read-only loaders for the side panel, which lives in the app layout and so
// can't take a thread from the page's search params like /assistant does.
// Threads stay private to their creator, as on the page.
async function requireAssistantUser(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (!(await isAssistantEnabled())) return null;
  return session.user.id;
}

export async function loadAssistantThreads(): Promise<ThreadSummary[]> {
  const userId = await requireAssistantUser();
  if (!userId) return [];
  return listChatThreads(userId);
}

/** The thread's visible messages, or null if it isn't the caller's. */
export async function loadAssistantThread(threadId: string): Promise<DisplayMessage[] | null> {
  const userId = await requireAssistantUser();
  if (!userId || typeof threadId !== "string") return null;
  const rows = await getChatThreadMessages(userId, threadId);
  if (!rows) return null;
  return rows.map((m) => ({
    id: m.id,
    role: m.role as "USER" | "ASSISTANT",
    content: m.content,
  }));
}
