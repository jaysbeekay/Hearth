export const AI_PROVIDERS = ["ANTHROPIC", "GEMINI", "OPENAI", "OLLAMA", "OPENROUTER"] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];

export const AI_PROVIDER_LABELS: Record<AiProviderId, string> = {
  ANTHROPIC: "Anthropic Claude",
  GEMINI: "Google Gemini",
  OPENAI: "OpenAI",
  OLLAMA: "Ollama (local)",
  OPENROUTER: "OpenRouter",
};

// Used when a user leaves the optional "Model" field blank.
export const AI_PROVIDER_DEFAULT_MODELS: Record<AiProviderId, string> = {
  ANTHROPIC: "claude-sonnet-4-5",
  GEMINI: "gemini-2.0-flash",
  OPENAI: "gpt-4o",
  OLLAMA: "llava",
  OPENROUTER: "openai/gpt-4o-mini",
};

// Ollama has no per-user secret — it routes through the shared local server
// already configured in Settings > System, so it never needs an API key.
export const AI_PROVIDERS_WITHOUT_API_KEY: readonly AiProviderId[] = ["OLLAMA"];

export interface ByokUser {
  aiProvider: AiProviderId | null;
  aiApiKeyEncrypted: string | null;
  aiModel: string | null;
}

export type ConfiguredByokUser = ByokUser & {
  aiProvider: AiProviderId;
};

// Same shape as ByokUser, but for the chat assistant's own independent
// provider/key/model triple (User.chatProvider etc) — kept separate so a
// household member can use a different provider/model for chat than for
// document-extraction BYOK.
export interface ChatUser {
  chatProvider: AiProviderId | null;
  chatApiKeyEncrypted: string | null;
  chatModel: string | null;
}

export type ConfiguredChatUser = ChatUser & {
  chatProvider: AiProviderId;
};
