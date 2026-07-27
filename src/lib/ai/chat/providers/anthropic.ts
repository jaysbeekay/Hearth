import {
  CHAT_PROVIDER_TIMEOUT_MS,
  type ChatProviderCall,
  type ChatTurn,
  type ToolCallRequest,
} from "@/lib/ai/chat/types";
import { readSseStream } from "@/lib/ai/chat/streamParsing";

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

// Anthropic has no separate "tool" role — a tool result is a `user` message
// containing a `tool_result` block referencing the original `tool_use` id.
function toAnthropicMessages(messages: ChatTurn[]) {
  return messages.map((turn) => {
    if (turn.role === "user") {
      return { role: "user", content: [{ type: "text", text: turn.content }] };
    }
    if (turn.role === "tool") {
      return {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: turn.toolCallId, content: turn.content }],
      };
    }
    const blocks: AnthropicContentBlock[] = [];
    if (turn.content) blocks.push({ type: "text", text: turn.content });
    for (const call of turn.toolCalls ?? []) {
      blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
    }
    return { role: "assistant", content: blocks };
  });
}

function errorKindForStatus(status: number): "auth" | "rate_limit" | "unknown" {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  return "unknown";
}

// One in-progress content block, tracked by its Anthropic content index —
// tool_use blocks stream their input as successive `partial_json` string
// fragments, joined and parsed only once the block closes.
interface StreamingBlock {
  type: "text" | "tool_use";
  id?: string;
  name?: string;
  text: string;
  partialJson: string;
}

export const callAnthropicChat: ChatProviderCall = async ({
  apiKey,
  model,
  system,
  messages,
  tools,
}, onDelta) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHAT_PROVIDER_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system,
        messages: toAnthropicMessages(messages),
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
        })),
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const message =
        (body as { error?: { message?: string } } | null)?.error?.message ?? res.statusText;
      return { ok: false, errorKind: errorKindForStatus(res.status), message };
    }
    if (!res.body) {
      return { ok: false, errorKind: "unknown", message: "Anthropic returned an empty stream." };
    }

    const blocks = new Map<number, StreamingBlock>();

    await readSseStream(res.body, (data) => {
      if (data === "[DONE]") return;
      let event: {
        type?: string;
        index?: number;
        content_block?: AnthropicContentBlock;
        delta?: { type?: string; text?: string; partial_json?: string };
      };
      try {
        event = JSON.parse(data);
      } catch {
        return;
      }

      if (event.type === "content_block_start" && event.index != null && event.content_block) {
        const cb = event.content_block;
        blocks.set(event.index, {
          type: cb.type === "tool_use" ? "tool_use" : "text",
          id: cb.id,
          name: cb.name,
          text: cb.text ?? "",
          partialJson: "",
        });
      } else if (event.type === "content_block_delta" && event.index != null) {
        const block = blocks.get(event.index);
        if (!block) return;
        if (event.delta?.type === "text_delta" && event.delta.text) {
          block.text += event.delta.text;
          onDelta?.(event.delta.text);
        } else if (event.delta?.type === "input_json_delta" && event.delta.partial_json) {
          block.partialJson += event.delta.partial_json;
        }
      }
    });

    let text = "";
    const toolCalls: ToolCallRequest[] = [];
    for (const block of blocks.values()) {
      if (block.type === "text") {
        text += block.text;
      } else {
        let input: Record<string, unknown> = {};
        try {
          input = block.partialJson ? JSON.parse(block.partialJson) : {};
        } catch {
          // malformed streamed arguments — pass an empty object rather than failing the turn
        }
        toolCalls.push({ id: block.id!, name: block.name!, input });
      }
    }

    return { ok: true, text: text.trim() || null, toolCalls };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      errorKind: "network",
      message: isAbort ? "Request to Anthropic timed out." : "Could not reach Anthropic.",
    };
  } finally {
    clearTimeout(timeout);
  }
};
