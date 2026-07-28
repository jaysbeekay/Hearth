import {
  CHAT_PROVIDER_TIMEOUT_MS,
  type ChatProviderCall,
  type ChatTurn,
  type ToolCallRequest,
} from "@/lib/ai/chat/types";
import { readSseStream } from "@/lib/ai/chat/streamParsing";

// OpenRouter mirrors OpenAI's chat/completions + tool-calling shape exactly,
// so this is the same message/tool translation as providers/openai.ts —
// only the endpoint differs. Tool-calling support itself depends on the
// specific model routed to; unsupported models simply won't emit tool_calls.
function toOpenAiMessages(system: string, messages: ChatTurn[]) {
  const out: Record<string, unknown>[] = [{ role: "system", content: system }];
  for (const turn of messages) {
    if (turn.role === "user") {
      out.push({ role: "user", content: turn.content });
    } else if (turn.role === "tool") {
      out.push({ role: "tool", tool_call_id: turn.toolCallId, content: turn.content });
    } else {
      out.push({
        role: "assistant",
        content: turn.content || null,
        tool_calls: turn.toolCalls?.length
          ? turn.toolCalls.map((c) => ({
              id: c.id,
              type: "function",
              function: { name: c.name, arguments: JSON.stringify(c.input) },
            }))
          : undefined,
      });
    }
  }
  return out;
}

function errorKindForStatus(status: number): "auth" | "rate_limit" | "unknown" {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  return "unknown";
}

interface StreamingToolCall {
  id: string;
  name: string;
  arguments: string;
}

export const callOpenRouterChat: ChatProviderCall = async ({
  apiKey,
  model,
  system,
  messages,
  tools,
}, onDelta) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHAT_PROVIDER_TIMEOUT_MS);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: toOpenAiMessages(system, messages),
        tools: tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.inputSchema },
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
      return { ok: false, errorKind: "unknown", message: "OpenRouter returned an empty stream." };
    }

    let text = "";
    const toolCalls = new Map<number, StreamingToolCall>();

    await readSseStream(res.body, (data) => {
      if (data === "[DONE]") return;
      let chunk: {
        choices?: {
          delta?: {
            content?: string;
            tool_calls?: {
              index: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }[];
          };
        }[];
      };
      try {
        chunk = JSON.parse(data);
      } catch {
        return;
      }

      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) {
        text += delta.content;
        onDelta?.(delta.content);
      }
      for (const tc of delta?.tool_calls ?? []) {
        const existing = toolCalls.get(tc.index) ?? { id: "", name: "", arguments: "" };
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.name = tc.function.name;
        if (tc.function?.arguments) existing.arguments += tc.function.arguments;
        toolCalls.set(tc.index, existing);
      }
    });

    const resolvedToolCalls: ToolCallRequest[] = Array.from(toolCalls.values()).map((c) => {
      let input: Record<string, unknown> = {};
      try {
        input = c.arguments ? JSON.parse(c.arguments) : {};
      } catch {
        // malformed streamed arguments — pass an empty object rather than failing the whole turn
      }
      return { id: c.id, name: c.name, input };
    });

    return { ok: true, text: text.trim() || null, toolCalls: resolvedToolCalls };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      errorKind: "network",
      message: isAbort ? "Request to OpenRouter timed out." : "Could not reach OpenRouter.",
    };
  } finally {
    clearTimeout(timeout);
  }
};
