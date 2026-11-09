import type { ChatTurn, ToolCallRequest } from "@/lib/ai/chat/types";
import { STOPPED_REPLY_NOTE } from "@/lib/chat/streamEvents";

/** The saved fields of a ChatMessage that replay needs. */
export interface ReplayRow {
  role: "USER" | "ASSISTANT" | "TOOL";
  content: string;
  toolCalls: string | null;
  toolCallId: string | null;
  toolName: string | null;
  createdAt: Date;
}

/**
 * Replaces the "(stopped)" note on a stopped reply when it's replayed, so the
 * provider doesn't read it as words the model wrote.
 */
export const STOPPED_REPLY_REPLAY_NOTE = "[The user stopped this reply here.]";

function replayAssistantText(content: string): string {
  if (!content.endsWith(STOPPED_REPLY_NOTE)) return content;
  const text = content.slice(0, -STOPPED_REPLY_NOTE.length).trimEnd();
  return text ? `${text}\n\n${STOPPED_REPLY_REPLAY_NOTE}` : STOPPED_REPLY_REPLAY_NOTE;
}

function parseToolCalls(json: string | null): ToolCallRequest[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as ToolCallRequest[]) : [];
  } catch {
    return [];
  }
}

/**
 * A thread's saved rows as the turns replayed to the provider.
 *
 * Providers reject a tool call without its result, and a result without its
 * call. A stopped turn, or the history window's cut-off, can leave either, and
 * a result can be saved after a later message. So each result is placed right
 * after the call that asked for it, calls without a result are dropped (and
 * the assistant row with them if it has no text), and results whose call
 * isn't in the history are dropped.
 */
export function toReplayTurns(rows: ReplayRow[]): ChatTurn[] {
  const ordered = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const results = new Map<string, ReplayRow>();
  for (const row of ordered) {
    if (row.role === "TOOL" && row.toolCallId) results.set(row.toolCallId, row);
  }

  const turns: ChatTurn[] = [];
  for (const row of ordered) {
    if (row.role === "USER") {
      turns.push({ role: "user", content: row.content });
      continue;
    }
    if (row.role === "TOOL") continue;

    const answered = parseToolCalls(row.toolCalls).filter((call) => results.has(call.id));
    const content = replayAssistantText(row.content);
    if (answered.length === 0) {
      if (content.trim()) turns.push({ role: "assistant", content });
      continue;
    }
    turns.push({ role: "assistant", content, toolCalls: answered });
    for (const call of answered) {
      const result = results.get(call.id);
      if (!result) continue;
      turns.push({
        role: "tool",
        toolCallId: call.id,
        name: result.toolName ?? call.name,
        content: result.content,
      });
    }
  }
  return turns;
}
