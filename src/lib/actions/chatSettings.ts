"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { isEncryptionConfigured, isDemoMode } from "@/lib/env";
import { chatSettingsSchema } from "@/lib/validation/chat";
import { AI_PROVIDERS_WITHOUT_API_KEY } from "@/lib/ai/types";

export type ActionState = { error?: string; success?: string } | null;

const DEMO_DISABLED_MESSAGE = "The AI assistant is disabled in this public demo.";

export async function saveChatSettings(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (isDemoMode()) return { error: DEMO_DISABLED_MESSAGE };

  const session = await auth();
  if (!session?.user) return { error: "Not signed in." };

  const parsed = chatSettingsSchema.safeParse({
    provider: formData.get("provider"),
    apiKey: formData.get("apiKey") || undefined,
    model: formData.get("model") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const needsApiKey = !AI_PROVIDERS_WITHOUT_API_KEY.includes(parsed.data.provider);
  if (needsApiKey && !isEncryptionConfigured()) {
    return { error: "Set ENCRYPTION_KEY on the server before configuring an API key." };
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      chatProvider: parsed.data.provider,
      chatApiKeyEncrypted: needsApiKey ? encryptSecret(parsed.data.apiKey!) : null,
      chatModel: parsed.data.model ?? null,
    },
  });

  revalidatePath("/settings");
  return { success: needsApiKey ? "API key saved." : "Provider saved." };
}

export async function removeChatSettings(): Promise<ActionState> {
  if (isDemoMode()) return { error: DEMO_DISABLED_MESSAGE };

  const session = await auth();
  if (!session?.user) return { error: "Not signed in." };

  await prisma.user.update({
    where: { id: session.user.id },
    data: { chatProvider: null, chatApiKeyEncrypted: null, chatModel: null },
  });

  revalidatePath("/settings");
  return { success: "API key removed." };
}
