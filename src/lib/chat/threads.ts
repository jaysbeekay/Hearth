import { prisma } from "@/lib/prisma";

// Plain data-fetchers (not a "use server" action file) — called from the
// Assistant server component, not invoked directly from the client.

export async function listChatThreads(userId: string) {
  return prisma.chatThread.findMany({
    where: { createdById: userId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, updatedAt: true },
  });
}

export async function getChatThreadMessages(userId: string, threadId: string) {
  const thread = await prisma.chatThread.findUnique({ where: { id: threadId } });
  if (!thread || thread.createdById !== userId) return null;

  const messages = await prisma.chatMessage.findMany({
    where: { threadId, role: { in: ["USER", "ASSISTANT"] } },
    orderBy: { createdAt: "asc" },
  });
  // Assistant turns that only requested tool calls (no visible text) are
  // internal plumbing, not part of the transcript shown to the user.
  return messages.filter((m) => m.role === "USER" || m.content.trim().length > 0);
}
