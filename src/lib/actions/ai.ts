"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/actions/app-settings";
import { setAppSetting } from "@/lib/appSettings";
import { isEncryptionConfigured } from "@/lib/env";
import { aiSettingsSchema } from "@/lib/validation/ai";
import { AI_PROVIDERS_WITHOUT_API_KEY } from "@/lib/ai/types";

export type ActionState = { error?: string; success?: string } | null;

// Household-wide, admin-only — see src/lib/ai/extract.ts's getByokConfig().
export async function saveAiSettings(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const parsed = aiSettingsSchema.safeParse({
    provider: formData.get("provider"),
    apiKey: formData.get("apiKey") || undefined,
    model: formData.get("model") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const needsApiKey = !AI_PROVIDERS_WITHOUT_API_KEY.includes(parsed.data.provider);
  if (needsApiKey && parsed.data.apiKey && !isEncryptionConfigured()) {
    return { error: "Set ENCRYPTION_KEY on the server before configuring an API key." };
  }

  try {
    await setAppSetting("ai.provider", parsed.data.provider);
    await setAppSetting("ai.model", parsed.data.model ?? "");
    // Sensitive: only overwrite if a new value was submitted
    if (parsed.data.apiKey) await setAppSetting("ai.apiKey", parsed.data.apiKey);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to save AI settings." };
  }

  revalidatePath("/settings/app");
  return { success: "AI document extraction settings saved." };
}

export async function removeAiSettings(): Promise<ActionState> {
  await requireAdmin();

  try {
    await setAppSetting("ai.provider", "");
    await setAppSetting("ai.apiKey", "");
    await setAppSetting("ai.model", "");
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to remove AI settings." };
  }

  revalidatePath("/settings/app");
  return { success: "AI document extraction settings removed." };
}
