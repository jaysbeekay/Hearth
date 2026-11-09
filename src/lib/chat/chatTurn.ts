import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import {
  MAX_TOOL_CALL_ROUNDS,
  type ChatProviderResult,
  type ChatTurn,
} from "@/lib/ai/chat/types";
import { markReplyStopped, type ChatStreamEvent } from "@/lib/chat/streamEvents";

/** One provider call: the configured provider, with system prompt and tools already bound. */
export type ChatTurnProvider = (
  messages: ChatTurn[],
  onDelta: (text: string) => void,
  signal: AbortSignal,
) => Promise<ChatProviderResult>;

interface ProposalResult {
  proposed: true;
  entity: "contract" | "product";
  operation: "create" | "update";
  entityId?: string;
  label?: string;
  data: Record<string, unknown>;
  displayValues?: Record<string, string>;
  currentValues?: Record<string, unknown>;
  warnings?: Record<string, string[]>;
}

function asProposal(toolResult: string): ProposalResult | null {
  const parsed: unknown = JSON.parse(toolResult);
  if (
    parsed &&
    typeof parsed === "object" &&
    "proposed" in parsed &&
    (parsed as { proposed?: boolean }).proposed
  ) {
    return parsed as ProposalResult;
  }
  return null;
}

/**
 * Runs one Assistant turn: calls the provider, runs any tools it asks for,
 * and repeats until it answers or runs out of rounds, saving each message to
 * the thread and emitting stream events as it goes.
 *
 * `signal` aborts when the user stops the reply or the client goes away.
 * The turn then makes no further provider calls or tool rounds: the current
 * round's tool calls finish (so every saved tool call has its result for
 * replay), proposal cards aren't shown, and any text the user saw that isn't
 * saved yet is saved marked as stopped. If no text had streamed, nothing is
 * saved for the reply.
 */
export async function runChatTurn({
  threadId,
  messages,
  signal,
  emit,
  callProvider,
  runTool,
}: {
  threadId: string;
  messages: ChatTurn[];
  signal: AbortSignal;
  emit: (event: ChatStreamEvent) => void;
  callProvider: ChatTurnProvider;
  runTool: (name: string, input: Record<string, unknown>) => Promise<string>;
}): Promise<void> {
  let finalText: string | null = null;
  // Every chunk the user has seen this turn, and the part of it not yet saved.
  let streamedText = "";
  let unsavedText = "";

  async function saveStopped() {
    if (streamedText.trim()) {
      await prisma.chatMessage.create({
        data: { threadId, role: "ASSISTANT", content: markReplyStopped(unsavedText) },
      });
    }
    await touchThread(threadId);
  }

  for (let round = 0; round < MAX_TOOL_CALL_ROUNDS; round++) {
    if (signal.aborted) {
      await saveStopped();
      return;
    }

    unsavedText = "";
    const result = await callProvider(
      messages,
      (delta) => {
        streamedText += delta;
        unsavedText += delta;
        emit({ type: "delta", text: delta });
      },
      signal,
    );

    if (!result.ok) {
      if (signal.aborted) {
        await saveStopped();
        return;
      }
      emit({ type: "error", message: result.message });
      return;
    }

    if (result.toolCalls.length === 0) {
      finalText = result.text ?? "";
      await prisma.chatMessage.create({
        data: { threadId, role: "ASSISTANT", content: finalText },
      });
      break;
    }

    const assistantContent = result.text ?? "";
    await prisma.chatMessage.create({
      data: {
        threadId,
        role: "ASSISTANT",
        content: assistantContent,
        toolCalls: JSON.stringify(result.toolCalls),
      },
    });
    unsavedText = "";
    messages.push({ role: "assistant", content: assistantContent, toolCalls: result.toolCalls });

    for (const call of result.toolCalls) {
      emit({ type: "tool_call", name: call.name });
      const toolResult = await runTool(call.name, call.input);
      await prisma.chatMessage.create({
        data: {
          threadId,
          role: "TOOL",
          content: toolResult,
          toolCallId: call.id,
          toolName: call.name,
        },
      });
      messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: toolResult });

      const proposal = asProposal(toolResult);
      if (proposal && !signal.aborted) {
        emit({
          type: "proposed_action",
          id: randomUUID(),
          entity: proposal.entity,
          operation: proposal.operation,
          entityId: proposal.entityId,
          label: proposal.label,
          data: proposal.data,
          displayValues: proposal.displayValues,
          currentValues: proposal.currentValues,
          warnings: proposal.warnings,
        });
      }
    }
  }

  if (finalText === null) {
    finalText =
      "I wasn't able to finish that within the allowed number of steps — try asking something narrower.";
    emit({ type: "delta", text: finalText });
    await prisma.chatMessage.create({
      data: { threadId, role: "ASSISTANT", content: finalText },
    });
  }

  await touchThread(threadId);
  emit({ type: "done", threadId });
}

async function touchThread(threadId: string) {
  await prisma.chatThread.update({ where: { id: threadId }, data: { updatedAt: new Date() } });
}
