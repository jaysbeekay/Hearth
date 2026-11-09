import { getAppSetting } from "@/lib/appSettings";
import { getChatConfig, isChatConfigured } from "@/lib/ai/chat/dispatch";

// Household switch for the AI assistant. Every entry point checks it on the
// server: the page, /api/chat, the thread actions and the confirm-card writes. Off
// unless an admin opts in at setup or in Settings → AI & privacy. Separate
// from the provider config: a key can stay saved while the assistant is off.
export const ASSISTANT_ENABLED_KEY = "assistant.enabled";

export async function isAssistantEnabled(): Promise<boolean> {
  return (await getAppSetting(ASSISTANT_ENABLED_KEY)) === "true";
}

/** What every Assistant entry point says when the household has it off. */
export const ASSISTANT_OFF_MESSAGE = "The assistant is turned off.";

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
