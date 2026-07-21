"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Called directly from ConfirmForm (a plain () => Promise<unknown> closure,
// not a form-bound action), so this takes a direct arg rather than FormData.
export async function deleteChatThread(threadId: string): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in.");

  const thread = await prisma.chatThread.findUnique({ where: { id: threadId } });
  if (!thread || thread.createdById !== session.user.id) {
    throw new Error("Conversation not found.");
  }

  await prisma.chatThread.delete({ where: { id: threadId } });
  revalidatePath("/assistant");
  redirect("/assistant");
}
