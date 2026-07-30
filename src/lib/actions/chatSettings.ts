"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/actions/app-settings";
import { setAppSetting } from "@/lib/appSettings";
import { isEncryptionConfigured } from "@/lib/env";
import { chatSettingsSchema } from "@/lib/validation/chat";
import { AI_PROVIDERS_WITHOUT_API_KEY } from "@/lib/ai/types";

export type ActionState = { error?: string; success?: string } | null;

// Household-wide, admin-only — see src/lib/ai/chat/dispatch.ts's getChatConfig().
export async function saveChatSettings(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const parsed = chatSettingsSchema.safeParse({
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
    await setAppSetting("chat.provider", parsed.data.provider);
    await setAppSetting("chat.model", parsed.data.model ?? "");
    // Sensitive: only overwrite if a new value was submitted
    if (parsed.data.apiKey) await setAppSetting("chat.apiKey", parsed.data.apiKey);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to save assistant settings." };
  }

  revalidatePath("/settings/app");
  return { success: "AI Assistant settings saved." };
}

export async function removeChatSettings(): Promise<ActionState> {
  await requireAdmin();

  try {
    await setAppSetting("chat.provider", "");
    await setAppSetting("chat.apiKey", "");
    await setAppSetting("chat.model", "");
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to remove assistant settings." };
  }

  revalidatePath("/settings/app");
  return { success: "AI Assistant settings removed." };
}
