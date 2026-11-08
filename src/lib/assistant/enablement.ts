import { getAppSetting } from "@/lib/appSettings";
import { getChatConfig, isChatConfigured } from "@/lib/ai/chat/dispatch";

// Household switch for the AI assistant (page, side panel, /api/chat). Off
// unless an admin opts in at setup or in Settings → AI & privacy. Separate
// from the provider config: a key can stay saved while the assistant is off.
export const ASSISTANT_ENABLED_KEY = "assistant.enabled";

export async function isAssistantEnabled(): Promise<boolean> {
  return (await getAppSetting(ASSISTANT_ENABLED_KEY)) === "true";
}

export interface AssistantAvailability {
  /** The household switch is on. */
  enabled: boolean;
  /** A provider (and key, where one is needed) is saved. */
  configured: boolean;
  /** Both: members can chat. */
  available: boolean;
}

export async function getAssistantAvailability(): Promise<AssistantAvailability> {
  const [enabled, chatConfig] = await Promise.all([isAssistantEnabled(), getChatConfig()]);
  const configured = isChatConfigured(chatConfig);
  return { enabled, configured, available: enabled && configured };
}
