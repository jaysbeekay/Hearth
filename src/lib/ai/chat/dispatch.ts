import { prisma } from "@/lib/prisma";
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

export async function getChatUser(userId: string): Promise<ChatUser | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { chatProvider: true, chatApiKeyEncrypted: true, chatModel: true },
  });
}

export async function callChatCompletion(
  user: ChatUser,
  system: string,
  messages: ChatTurn[],
  tools: ToolDefinition[],
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
  return call({ apiKey, model, system, messages, tools });
}
