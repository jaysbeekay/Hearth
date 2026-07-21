import { randomUUID } from "crypto";
import { getOllamaConfig } from "@/lib/appSettings";
import {
  CHAT_PROVIDER_TIMEOUT_MS,
  type ChatProviderCall,
  type ChatTurn,
  type ToolCallRequest,
} from "@/lib/ai/chat/types";

// Ollama's /api/chat mirrors OpenAI's chat shape closely, with two
// differences: tool-call `arguments` are a plain object (not a JSON
// string), and neither tool calls nor tool results carry an id — Ollama
// correlates by conversation order only, same as Gemini.
function toOllamaMessages(system: string, messages: ChatTurn[]) {
  const out: Record<string, unknown>[] = [{ role: "system", content: system }];
  for (const turn of messages) {
    if (turn.role === "user") {
      out.push({ role: "user", content: turn.content });
    } else if (turn.role === "tool") {
      out.push({ role: "tool", content: turn.content });
    } else {
      out.push({
        role: "assistant",
        content: turn.content,
        tool_calls: turn.toolCalls?.length
          ? turn.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.input } }))
          : undefined,
      });
    }
  }
  return out;
}

// Only the base URL is inherently system-wide (it's the household's shared
// local server) — unlike the extraction provider, the *model* here prefers
// the caller's chat-settings model over Settings > System's Ollama model,
// since that system default is tuned for extraction's vision use case, not
// chat's tool-calling/text use case.
export const callOllamaChat: ChatProviderCall = async ({ model, system, messages, tools }) => {
  const ollama = await getOllamaConfig();
  if (!ollama.baseUrl) {
    return {
      ok: false,
      errorKind: "unknown",
      message: "Ollama isn't configured — set a base URL in Settings > System.",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHAT_PROVIDER_TIMEOUT_MS);
  try {
    const res = await fetch(`${ollama.baseUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: toOllamaMessages(system, messages),
        tools: tools.length
          ? tools.map((t) => ({
              type: "function",
              function: { name: t.name, description: t.description, parameters: t.inputSchema },
            }))
          : undefined,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const message = (body as { error?: string } | null)?.error ?? res.statusText;
      return { ok: false, errorKind: "unknown", message };
    }

    const json = (await res.json()) as {
      message?: {
        content?: string;
        tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
      };
    };
    const toolCalls: ToolCallRequest[] = (json.message?.tool_calls ?? []).map((c) => ({
      id: randomUUID(),
      name: c.function.name,
      input: c.function.arguments ?? {},
    }));

    return { ok: true, text: json.message?.content?.trim() || null, toolCalls };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      errorKind: "network",
      message: isAbort ? "Request to Ollama timed out." : "Could not reach the Ollama server.",
    };
  } finally {
    clearTimeout(timeout);
  }
};
