import { getAppSettingRaw } from "@/lib/appSettings";
import { decryptSecret } from "@/lib/crypto";
import { callAnthropicChat } from "@/lib/ai/chat/providers/anthropic";
import { callGeminiChat } from "@/lib/ai/chat/providers/gemini";
import { callOpenAiChat } from "@/lib/ai/chat/providers/openai";
import { callOllamaChat } from "@/lib/ai/chat/providers/ollama";
import { callOpenRouterChat } from "@/lib/ai/chat/providers/openrouter";
import {
  CHAT_PROVIDER_DEFAULT_MODELS,
  type ChatProviderCall,
  type ChatProviderResult,
  type ChatTurn,
  type ToolDefinition,
} from "@/lib/ai/chat/types";
import {
  AI_PROVIDERS_WITHOUT_API_KEY,
  type AiProviderId,
  type ChatUser,
  type ConfiguredChatUser,
} from "@/lib/ai/types";

const PROVIDER_CALLS: Record<AiProviderId, ChatProviderCall> = {
  ANTHROPIC: callAnthropicChat,
  GEMINI: callGeminiChat,
  OPENAI: callOpenAiChat,
  OLLAMA: callOllamaChat,
  OPENROUTER: callOpenRouterChat,
};

export function isChatConfigured(
  user: ChatUser | null | undefined,
): user is ConfiguredChatUser {
  if (!user?.chatProvider) return false;
  if (AI_PROVIDERS_WITHOUT_API_KEY.includes(user.chatProvider)) return true;
  return Boolean(user.chatApiKeyEncrypted);
}

// AI Assistant provider/key/model is household-wide, not per-user — every
// household member shares one configured assistant, same as the read-only
// data it can query (see the ChatThread model comment in schema.prisma).
export async function getChatConfig(): Promise<ChatUser> {
  const [provider, apiKeyEncrypted, model] = await Promise.all([
    getAppSettingRaw("chat.provider"),
    getAppSettingRaw("chat.apiKey"),
    getAppSettingRaw("chat.model"),
  ]);
  return {
    chatProvider: (provider as AiProviderId | null) ?? null,
    chatApiKeyEncrypted: apiKeyEncrypted,
    chatModel: model,
  };
}

export async function callChatCompletion(
  user: ChatUser,
  system: string,
  messages: ChatTurn[],
  tools: ToolDefinition[],
  onDelta?: (text: string) => void,
): Promise<ChatProviderResult> {
  if (!isChatConfigured(user)) {
    return {
      ok: false,
      errorKind: "unknown",
      message: "No AI provider configured for the assistant — set one up in Settings.",
    };
  }

  const apiKey = user.chatApiKeyEncrypted ? decryptSecret(user.chatApiKeyEncrypted) : "";
  const model = user.chatModel || CHAT_PROVIDER_DEFAULT_MODELS[user.chatProvider];
  const call = PROVIDER_CALLS[user.chatProvider];
  return call({ apiKey, model, system, messages, tools }, onDelta);
}
