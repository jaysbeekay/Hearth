import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { callAnthropic } from "@/lib/ai/providers/anthropic";
import { callGemini } from "@/lib/ai/providers/gemini";
import { callOpenAi } from "@/lib/ai/providers/openai";
import { callOllama } from "@/lib/ai/providers/ollama";
import { callOpenRouter } from "@/lib/ai/providers/openrouter";
import type { ProviderCall } from "@/lib/ai/providers/types";
import {
  AI_PROVIDER_DEFAULT_MODELS,
  AI_PROVIDERS_WITHOUT_API_KEY,
  type AiProviderId,
  type ByokUser,
  type ConfiguredByokUser,
} from "@/lib/ai/types";

// Cloud providers read documents directly, so this is limited to formats
// they natively accept — the same gap as local OCR applies to .doc/.docx.
const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
]);

const PROVIDER_CALLS: Record<AiProviderId, ProviderCall> = {
  ANTHROPIC: callAnthropic,
  GEMINI: callGemini,
  OPENAI: callOpenAi,
  OLLAMA: callOllama,
  OPENROUTER: callOpenRouter,
};

export function isByokConfigured(
  user: ByokUser | null | undefined,
): user is ConfiguredByokUser {
  if (!user?.aiProvider) return false;
  if (AI_PROVIDERS_WITHOUT_API_KEY.includes(user.aiProvider)) return true;
  return Boolean(user.aiApiKeyEncrypted);
}

export async function getByokUser(userId: string): Promise<ByokUser | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { aiProvider: true, aiApiKeyEncrypted: true, aiModel: true },
  });
}

export async function extractWithByok(
  user: ByokUser,
  buffer: Buffer,
  mimeType: string,
  prompt: string,
): Promise<string | null> {
  if (!isByokConfigured(user) || !SUPPORTED_MIME_TYPES.has(mimeType)) return null;

  const apiKey = user.aiApiKeyEncrypted ? decryptSecret(user.aiApiKeyEncrypted) : "";
  const model = user.aiModel || AI_PROVIDER_DEFAULT_MODELS[user.aiProvider];
  const call = PROVIDER_CALLS[user.aiProvider];
  return call({ apiKey, model, buffer, mimeType, prompt });
}
