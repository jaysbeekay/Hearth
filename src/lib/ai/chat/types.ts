import type { AiProviderId } from "@/lib/ai/types";

// A JSON-Schema-shaped description of a tool's input, passed to each
// provider translated into that provider's own tool-calling wire format
// (Anthropic's `tools`, OpenAI's `function` tools, etc). Kept deliberately
// minimal (object/properties/required) — enough for the read-only data
// tools in src/lib/chat/tools.ts, not a general JSON Schema implementation.
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolCallRequest {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

// The provider-agnostic shape of one turn in a conversation, replayed in
// full on every request since none of these are stateful server-side
// threads (same one-request-in, one-response-out REST model as the
// existing extraction providers, just with history now included).
export type ChatTurn =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCallRequest[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export interface ChatProviderCallParams {
  apiKey: string;
  model: string;
  system: string;
  messages: ChatTurn[];
  tools: ToolDefinition[];
}

// Unlike extraction's ProviderCall (Promise<string | null>, collapsing every
// failure to null), chat surfaces a distinguishable error to the UI instead
// of a silent "the assistant didn't answer."
export type ChatProviderResult =
  | { ok: true; text: string | null; toolCalls: ToolCallRequest[] }
  | { ok: false; errorKind: "auth" | "rate_limit" | "network" | "unknown"; message: string };

export type ChatProviderCall = (params: ChatProviderCallParams) => Promise<ChatProviderResult>;

// Longer than extraction's 45s single-shot timeout — this is per model call
// within a tool-calling loop, but each call can involve more reasoning.
export const CHAT_PROVIDER_TIMEOUT_MS = 60_000;

// Chat wants a capable, tool-calling/instruction-following model rather than
// extraction's cheap/vision-oriented defaults — notably Ollama defaults to a
// text model here, not extraction's vision-only `llava`.
export const CHAT_PROVIDER_DEFAULT_MODELS: Record<AiProviderId, string> = {
  ANTHROPIC: "claude-sonnet-4-5",
  GEMINI: "gemini-2.0-flash",
  OPENAI: "gpt-4o",
  OLLAMA: "llama3.1",
  OPENROUTER: "openai/gpt-4o-mini",
};

// Caps how many tool-call round trips one user message can trigger before
// the loop gives up and returns whatever text the model has produced so
// far — a safety bound against a model stuck in a call/no-progress loop.
export const MAX_TOOL_CALL_ROUNDS = 6;
