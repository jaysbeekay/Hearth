import { randomUUID } from "crypto";
import {
  CHAT_PROVIDER_TIMEOUT_MS,
  type ChatProviderCall,
  type ChatTurn,
  type ToolCallRequest,
  type ToolDefinition,
} from "@/lib/ai/chat/types";
import { readSseStream } from "@/lib/ai/chat/streamParsing";

// Gemini has no separate "assistant"/"tool" roles — "model" stands in for
// assistant, and a function result is its own "function" role turn keyed by
// name (Gemini has no call-id concept at all, unlike Anthropic/OpenAI).
function toGeminiContents(messages: ChatTurn[]) {
  return messages.map((turn) => {
    if (turn.role === "user") {
      return { role: "user", parts: [{ text: turn.content }] };
    }
    if (turn.role === "tool") {
      let response: unknown;
      try {
        response = JSON.parse(turn.content);
      } catch {
        response = { result: turn.content };
      }
      return { role: "function", parts: [{ functionResponse: { name: turn.name, response } }] };
    }
    const parts: Record<string, unknown>[] = [];
    if (turn.content) parts.push({ text: turn.content });
    for (const call of turn.toolCalls ?? []) {
      parts.push({ functionCall: { name: call.name, args: call.input } });
    }
    return { role: "model", parts };
  });
}

// Gemini's function schema uses its own uppercase Type enum (OBJECT/STRING/
// NUMBER/...), not JSON Schema's lowercase type strings, so the shared
// ToolDefinition.inputSchema needs recursive re-casing before it's sent.
function convertSchemaNode(node: unknown): unknown {
  if (typeof node !== "object" || node === null) return node;
  const obj = node as Record<string, unknown>;
  const out: Record<string, unknown> = { ...obj };
  if (typeof obj.type === "string") out.type = obj.type.toUpperCase();
  if (obj.properties && typeof obj.properties === "object") {
    out.properties = Object.fromEntries(
      Object.entries(obj.properties as Record<string, unknown>).map(([k, v]) => [
        k,
        convertSchemaNode(v),
      ]),
    );
  }
  if (obj.items) out.items = convertSchemaNode(obj.items);
  return out;
}

function toGeminiSchema(schema: ToolDefinition["inputSchema"]) {
  return convertSchemaNode(schema);
}

function errorKindForStatus(status: number): "auth" | "rate_limit" | "unknown" {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  return "unknown";
}

export const callGeminiChat: ChatProviderCall = async ({
  apiKey,
  model,
  system,
  messages,
  tools,
}, onDelta) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHAT_PROVIDER_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: toGeminiContents(messages),
          tools: tools.length
            ? [
                {
                  functionDeclarations: tools.map((t) => ({
                    name: t.name,
                    description: t.description,
                    parameters: toGeminiSchema(t.inputSchema),
                  })),
                },
              ]
            : undefined,
        }),
        signal: controller.signal,
      },
    );

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const message =
        (body as { error?: { message?: string } } | null)?.error?.message ?? res.statusText;
      return { ok: false, errorKind: errorKindForStatus(res.status), message };
    }
    if (!res.body) {
      return { ok: false, errorKind: "unknown", message: "Gemini returned an empty stream." };
    }

    let text = "";
    const toolCalls: ToolCallRequest[] = [];

    await readSseStream(res.body, (data) => {
      let chunk: {
        candidates?: {
          content?: {
            parts?: { text?: string; functionCall?: { name: string; args?: Record<string, unknown> } }[];
          };
        }[];
      };
      try {
        chunk = JSON.parse(data);
      } catch {
        return;
      }

      const parts = chunk.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if (part.text) {
          text += part.text;
          onDelta?.(part.text);
        }
        if (part.functionCall) {
          toolCalls.push({
            id: randomUUID(),
            name: part.functionCall.name,
            input: part.functionCall.args ?? {},
          });
        }
      }
    });

    return { ok: true, text: text.trim() || null, toolCalls };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      errorKind: "network",
      message: isAbort ? "Request to Gemini timed out." : "Could not reach Gemini.",
    };
  } finally {
    clearTimeout(timeout);
  }
};
