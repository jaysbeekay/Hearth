import { z } from "zod";
import { AI_PROVIDERS, AI_PROVIDERS_WITHOUT_API_KEY } from "@/lib/ai/types";

// Same shape as validation/ai.ts's aiSettingsSchema — chat has its own
// provider/key/model triple (see User.chatProvider etc.) so a household
// member can pick a different, stronger model for chat than for document
// extraction, but the validation rules are identical.
export const chatSettingsSchema = z
  .object({
    provider: z.enum(AI_PROVIDERS),
    apiKey: z.string().trim().max(500).optional(),
    model: z.string().trim().max(100).optional(),
  })
  .refine(
    (data) =>
      AI_PROVIDERS_WITHOUT_API_KEY.includes(data.provider) ||
      (data.apiKey && data.apiKey.length >= 20),
    { message: "Enter a valid API key", path: ["apiKey"] },
  );

export const sendChatMessageSchema = z.object({
  threadId: z.string().min(1).nullable(),
  message: z.string().trim().min(1).max(4000),
});
