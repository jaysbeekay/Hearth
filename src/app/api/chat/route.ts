import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { sendChatMessageSchema } from "@/lib/validation/chat";
import { callChatCompletion, getChatUser, isChatConfigured } from "@/lib/ai/chat/dispatch";
import { MAX_TOOL_CALL_ROUNDS, type ChatTurn } from "@/lib/ai/chat/types";
import { getAvailableTools, runTool, type ToolContext } from "@/lib/chat/tools";
import type { ChatMessageModel } from "@/generated/prisma/models";

const SYSTEM_PROMPT =
  "You are the household assistant built into Hearth, a household management app. " +
  "Answer questions about the household's own data — contracts, warranties/products, " +
  "trips, vehicles, home/properties, inventory, and wealth — using the tools available " +
  "to you. Only use information returned by tools or provided in the conversation; never " +
  "invent figures, dates, or record details. If a tool returns no results, say so plainly " +
  "rather than guessing. You are strictly read-only: you cannot create, edit, or delete " +
  "anything, and should never claim to have done so. Keep answers concise and use the " +
  "currency figures exactly as returned by tools, without converting between currencies.";

function rowToTurn(row: ChatMessageModel): ChatTurn {
  if (row.role === "USER") return { role: "user", content: row.content };
  if (row.role === "TOOL") {
    return {
      role: "tool",
      toolCallId: row.toolCallId ?? "",
      name: row.toolName ?? "",
      content: row.content,
    };
  }
  return {
    role: "assistant",
    content: row.content,
    toolCalls: row.toolCalls ? JSON.parse(row.toolCalls) : undefined,
  };
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = sendChatMessageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const { threadId: requestedThreadId, message } = parsed.data;

  const thread = requestedThreadId
    ? await prisma.chatThread.findUnique({ where: { id: requestedThreadId } })
    : await prisma.chatThread.create({
        data: { createdById: session.user.id, title: message.slice(0, 60) },
      });

  if (!thread || thread.createdById !== session.user.id) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  const chatUser = await getChatUser(session.user.id);
  if (!isChatConfigured(chatUser)) {
    return NextResponse.json({
      threadId: thread.id,
      error: "No AI provider configured for the assistant — set one up in Settings.",
    });
  }

  const priorRows = await prisma.chatMessage.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: "asc" },
  });
  const messages: ChatTurn[] = priorRows.map(rowToTurn);

  await prisma.chatMessage.create({
    data: { threadId: thread.id, role: "USER", content: message },
  });
  messages.push({ role: "user", content: message });

  const enabledModules = await getEnabledModuleKeys();
  const tools = getAvailableTools(enabledModules);
  const ctx: ToolContext = { userId: session.user.id, enabledModules };

  let finalText: string | null = null;
  let providerErrorMessage: string | null = null;

  for (let round = 0; round < MAX_TOOL_CALL_ROUNDS; round++) {
    const result = await callChatCompletion(chatUser, SYSTEM_PROMPT, messages, tools);

    if (!result.ok) {
      providerErrorMessage = result.message;
      break;
    }

    if (result.toolCalls.length === 0) {
      finalText = result.text ?? "";
      await prisma.chatMessage.create({
        data: { threadId: thread.id, role: "ASSISTANT", content: finalText },
      });
      break;
    }

    const assistantContent = result.text ?? "";
    await prisma.chatMessage.create({
      data: {
        threadId: thread.id,
        role: "ASSISTANT",
        content: assistantContent,
        toolCalls: JSON.stringify(result.toolCalls),
      },
    });
    messages.push({ role: "assistant", content: assistantContent, toolCalls: result.toolCalls });

    for (const call of result.toolCalls) {
      const toolResult = await runTool(call.name, call.input, ctx);
      await prisma.chatMessage.create({
        data: {
          threadId: thread.id,
          role: "TOOL",
          content: toolResult,
          toolCallId: call.id,
          toolName: call.name,
        },
      });
      messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: toolResult });
    }
  }

  if (providerErrorMessage) {
    return NextResponse.json({ threadId: thread.id, error: providerErrorMessage });
  }

  if (finalText === null) {
    finalText =
      "I wasn't able to finish that within the allowed number of steps — try asking something narrower.";
    await prisma.chatMessage.create({
      data: { threadId: thread.id, role: "ASSISTANT", content: finalText },
    });
  }

  await prisma.chatThread.update({
    where: { id: thread.id },
    data: { updatedAt: new Date() },
  });

  return NextResponse.json({ threadId: thread.id, message: finalText });
}
