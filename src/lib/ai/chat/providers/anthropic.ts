import {
  CHAT_PROVIDER_TIMEOUT_MS,
  type ChatProviderCall,
  type ChatTurn,
  type ToolCallRequest,
} from "@/lib/ai/chat/types";

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

export const callAnthropicChat: ChatProviderCall = async ({
  apiKey,
  model,
  system,
  messages,
  tools,
}) => {
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
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const message =
        (body as { error?: { message?: string } } | null)?.error?.message ?? res.statusText;
      return { ok: false, errorKind: errorKindForStatus(res.status), message };
    }

    const json = (await res.json()) as { content?: AnthropicContentBlock[] };
    const blocks = json.content ?? [];
    const text = blocks
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text)
      .join("\n")
      .trim();
    const toolCalls: ToolCallRequest[] = blocks
      .filter((b) => b.type === "tool_use")
      .map((b) => ({ id: b.id!, name: b.name!, input: b.input ?? {} }));

    return { ok: true, text: text || null, toolCalls };
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
