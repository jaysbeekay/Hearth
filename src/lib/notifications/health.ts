import { isSmtpConfigured, isNtfyConfigured, getReminderConfig } from "@/lib/appSettings";
import { getEnabledWebhookEndpoints } from "@/lib/notifications/webhook";
import { parseThresholds } from "@/lib/notifications/thresholds";
import { getNotificationLogsByOwner } from "@/lib/notifications/logs";
import type { NotificationOwnerType } from "@/generated/prisma/enums";

export interface ReminderHealth {
  /** True when there's a target date and at least one threshold configured — i.e. a reminder could fire at all. */
  enabled: boolean;
  thresholds: number[];
  /** Calendar date of the soonest not-yet-sent threshold, or null if none are outstanding (or reminders aren't enabled). */
  nextReminderDate: Date | null;
  channels: { email: boolean; ntfy: boolean; webhook: boolean };
  deliveryReady: boolean;
  lastSent: { channel: string; thresholdDays: number; sentAt: Date } | null;
  lastFailure: { channel: string; thresholdDays: number; sentAt: Date; error: string | null } | null;
}

/**
 * Computes the reminder-health block shown on contract/product/vehicle
 * detail pages and the dashboard (#201) — "is a reminder actually going to
 * fire, and did the last one work" rather than just "is a date set".
 */
export async function getReminderHealth(params: {
  ownerType: NotificationOwnerType;
  ownerId: string;
  /** Vehicle only — "regoExpiry" | "insuranceExpiry". Omit for contract/product. */
  field?: string;
  targetDate: Date | null;
  reminderDaysBefore: string | null;
}): Promise<ReminderHealth> {
  const [{ defaultDays }, emailEnabled, ntfyEnabled, webhookEndpoints, logsByOwner] = await Promise.all([
    getReminderConfig(),
    isSmtpConfigured(),
    isNtfyConfigured(),
    getEnabledWebhookEndpoints(),
    getNotificationLogsByOwner(params.ownerType, [params.ownerId]),
  ]);

  const thresholds = parseThresholds(params.reminderDaysBefore, defaultDays);
  const logs = (logsByOwner.get(params.ownerId) ?? []).filter((l) =>
    params.field ? l.field === params.field : l.field === "",
  );

  const sentThresholds = new Set(logs.filter((l) => l.status === "SENT").map((l) => l.thresholdDays));
  const unsent = thresholds.filter((t) => !sentThresholds.has(t));
  const nextThreshold = unsent.length > 0 ? Math.max(...unsent) : null;
  const nextReminderDate =
    params.targetDate && nextThreshold != null
      ? new Date(params.targetDate.getTime() - nextThreshold * 86_400_000)
      : null;

  const lastSentLog = [...logs.filter((l) => l.status === "SENT")].sort(
    (a, b) => b.sentAt.getTime() - a.sentAt.getTime(),
  )[0];
  const lastFailureLog = [...logs.filter((l) => l.status === "FAILED")].sort(
    (a, b) => b.sentAt.getTime() - a.sentAt.getTime(),
  )[0];

  return {
    enabled: params.targetDate != null && thresholds.length > 0,
    thresholds,
    nextReminderDate,
    channels: { email: emailEnabled, ntfy: ntfyEnabled, webhook: webhookEndpoints.length > 0 },
    deliveryReady: emailEnabled || ntfyEnabled || webhookEndpoints.length > 0,
    lastSent: lastSentLog
      ? { channel: lastSentLog.channel, thresholdDays: lastSentLog.thresholdDays, sentAt: lastSentLog.sentAt }
      : null,
    lastFailure: lastFailureLog
      ? {
          channel: lastFailureLog.channel,
          thresholdDays: lastFailureLog.thresholdDays,
          sentAt: lastFailureLog.sentAt,
          error: lastFailureLog.error,
        }
      : null,
  };
}
