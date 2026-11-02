import { formatDate } from "@/lib/utils";
import type { ReminderHealth } from "@/lib/notifications/health";

const CHANNEL_LABELS = new Map([
  ["EMAIL", "email"],
  ["NTFY", "ntfy"],
  ["WEBHOOK", "webhook"],
]);

export const channelLabel = (channel: string) => CHANNEL_LABELS.get(channel) ?? channel;

/** "Email + ntfy", or "None configured". */
export function channelSummary(channels: ReminderHealth["channels"]): string {
  const active = [channels.email && "Email", channels.ntfy && "ntfy", channels.webhook && "Webhook"].filter(Boolean);
  return active.length > 0 ? active.join(" + ") : "None configured";
}

export type ReminderTone = "neutral" | "warning" | "danger";

/**
 * #360 — a Reminder health card in one sentence: when the next Reminder goes
 * out, how, and on which thresholds; or why it won't. The household's
 * missing delivery set-up is said once by the card, not here.
 */
export function reminderSummary(
  health: ReminderHealth,
  dateFormat?: string | null,
): { tone: ReminderTone; text: string } {
  if (health.onHold) return { tone: "warning", text: "Reminders are on hold until this record is reviewed." };
  if (health.lastFailure) {
    const error = health.lastFailure.error ? ` — ${health.lastFailure.error}` : "";
    return { tone: "danger", text: `The last Reminder failed via ${channelLabel(health.lastFailure.channel)}${error}.` };
  }
  // #516 review — these three aren't "all sent", so each says what it is.
  if (health.thresholds.length === 0) {
    return { tone: "warning", text: "No Reminder thresholds are set, so no Reminders will be sent." };
  }
  // No Reminder entry: the date has passed, or (an auto-renewing Contract
  // with no notice period) there is nothing to be reminded of.
  if (!health.enabled) return { tone: "neutral", text: "No Reminder is scheduled for this date." };

  const when =
    health.nextReminder?.kind === "next-check"
      ? "Next reminder on the next check"
      : health.nextReminder
        ? `Next reminder ${formatDate(health.nextReminder.date, dateFormat)}`
        : health.lastSent
          ? "All Reminders for this date have been sent"
          : "No more Reminders for this date";
  const by = health.deliveryReady && health.nextReminder ? ` by ${channelSummary(health.channels).toLowerCase()}` : "";
  const thresholds = [...health.thresholds].sort((a, b) => b - a).join("/");
  return { tone: "neutral", text: `${when}${by} · thresholds ${thresholds}` };
}
