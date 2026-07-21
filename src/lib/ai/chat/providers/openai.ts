import {
  CHAT_PROVIDER_TIMEOUT_MS,
  type ChatProviderCall,
  type ChatTurn,
  type ToolCallRequest,
} from "@/lib/ai/chat/types";

// Chat Completions (not the Responses API the extraction provider uses) —
// its tool-calling shape is the de facto standard OpenRouter also mirrors,
// and there's no document-bytes input to justify Responses here.
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

export const callOpenAiChat: ChatProviderCall = async ({
  apiKey,
  model,
  system,
  messages,
  tools,
}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHAT_PROVIDER_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
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
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const message =
        (body as { error?: { message?: string } } | null)?.error?.message ?? res.statusText;
      return { ok: false, errorKind: errorKindForStatus(res.status), message };
    }

    const json = (await res.json()) as {
      choices?: {
        message?: {
          content?: string | null;
          tool_calls?: { id: string; function: { name: string; arguments: string } }[];
        };
      }[];
    };
    const message = json.choices?.[0]?.message;
    const toolCalls: ToolCallRequest[] = (message?.tool_calls ?? []).map((c) => {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(c.function.arguments);
      } catch {
        // malformed arguments — pass an empty object rather than failing the whole turn
      }
      return { id: c.id, name: c.function.name, input };
    });

    return { ok: true, text: message?.content?.trim() || null, toolCalls };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      errorKind: "network",
      message: isAbort ? "Request to OpenAI timed out." : "Could not reach OpenAI.",
    };
  } finally {
    clearTimeout(timeout);
  }
};
