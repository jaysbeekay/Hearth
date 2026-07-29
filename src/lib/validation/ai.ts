import { z } from "zod";
import { AI_PROVIDERS } from "@/lib/ai/types";

export const aiSettingsSchema = z
  .object({
    provider: z.enum(AI_PROVIDERS),
    apiKey: z.string().trim().max(500).optional(),
    model: z.string().trim().max(100).optional(),
  })
  .refine((data) => !data.apiKey || data.apiKey.length >= 20, {
    message: "Enter a valid API key",
    path: ["apiKey"],
  });
