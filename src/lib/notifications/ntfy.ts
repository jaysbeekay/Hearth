import { getNtfyConfig, isNtfyConfigured } from "@/lib/appSettings";
import { assertSafeOutboundUrl } from "@/lib/net/outbound";
import { buildNtfyReminder, type ReminderInput } from "@/lib/notifications/reminderContent";

function stripNewlines(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export async function sendTestNtfy() {
  if (!(await isNtfyConfigured())) throw new Error("ntfy is not configured.");

  const ntfy = await getNtfyConfig();
  const url = `${ntfy.url.replace(/\/$/, "")}/${ntfy.topic}`;
  const headers: Record<string, string> = {
    Title: "Hearth test notification",
    Priority: "default",
    Tags: "white_check_mark",
  };
  if (ntfy.token) headers.Authorization = `Bearer ${ntfy.token}`;

  await assertSafeOutboundUrl(url);
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: "This is a test notification from Hearth.",
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`ntfy request failed with status ${response.status}`);
  }
}

export async function sendNtfyReminder(input: ReminderInput) {
  if (!(await isNtfyConfigured())) return;

  const ntfy = await getNtfyConfig();
  const url = `${ntfy.url.replace(/\/$/, "")}/${ntfy.topic}`;
  // #352 — Click/Actions headers (when APP_URL is set) make tapping the
  // notification open the record.
  const { headers, body } = buildNtfyReminder(input);
  for (const key of Object.keys(headers)) headers[key] = stripNewlines(headers[key]);
  if (ntfy.token) {
    headers.Authorization = `Bearer ${ntfy.token}`;
  }

  await assertSafeOutboundUrl(url);
  const response = await fetch(url, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`ntfy request failed with status ${response.status}`);
  }
}
