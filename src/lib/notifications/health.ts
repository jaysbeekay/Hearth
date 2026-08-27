import { isSmtpConfigured, isNtfyConfigured, getReminderConfig } from "@/lib/appSettings";
import { getEnabledWebhookEndpoints } from "@/lib/notifications/webhook";
import { parseThresholds } from "@/lib/notifications/thresholds";
import { getNotificationLogsByOwner } from "@/lib/notifications/logs";
import { prisma } from "@/lib/prisma";
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

export interface UncoveredRecord {
  ownerType: NotificationOwnerType;
  title: string;
  href: string;
  /** Why this record has no working reminder coverage right now. */
  reason: "No reminder thresholds set" | "Last delivery attempt failed";
}

export interface HouseholdReminderHealth {
  channels: { email: boolean; ntfy: boolean; webhook: boolean };
  deliveryReady: boolean;
  /** Last 30 days, across every channel and record. */
  recentSent: number;
  recentFailed: number;
  /** Most recent SENT or FAILED log across the household — the closest
   * proxy for "did the scheduler do anything lately" available without a
   * dedicated job-run log (no job runner exists yet, see #250). */
  lastActivityAt: Date | null;
  /** Active/non-cancelled, non-trashed records expiring within 90 days that
   * have no working path to a delivered reminder — only computed when at
   * least one channel is configured, since with none configured every
   * expiring record is equally uncovered for the same one reason. */
  uncovered: UncoveredRecord[];
}

const UNCOVERED_HORIZON_DAYS = 90;

/**
 * Household-wide rollup of the same signals ReminderHealthCard shows per
 * record (#292) — so confirming "reminders are actually working" doesn't
 * require opening every record that happens to be expiring soon.
 */
export async function getHouseholdReminderHealth(): Promise<HouseholdReminderHealth> {
  const [{ defaultDays }, emailEnabled, ntfyEnabled, webhookEndpoints] = await Promise.all([
    getReminderConfig(),
    isSmtpConfigured(),
    isNtfyConfigured(),
    getEnabledWebhookEndpoints(),
  ]);
  const deliveryReady = emailEnabled || ntfyEnabled || webhookEndpoints.length > 0;

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [recentSent, recentFailed, lastLog] = await Promise.all([
    prisma.notificationLog.count({ where: { status: "SENT", sentAt: { gte: since } } }),
    prisma.notificationLog.count({ where: { status: "FAILED", sentAt: { gte: since } } }),
    prisma.notificationLog.findFirst({ orderBy: { sentAt: "desc" }, select: { sentAt: true } }),
  ]);

  const uncovered: UncoveredRecord[] = [];
  if (deliveryReady) {
    const now = new Date();
    const horizon = new Date(now.getTime() + UNCOVERED_HORIZON_DAYS * 24 * 60 * 60 * 1000);

    const [contracts, products, vehicles] = await Promise.all([
      prisma.contract.findMany({
        where: { status: "ACTIVE", deletedAt: null, endDate: { gte: now, lte: horizon } },
        select: { id: true, title: true, endDate: true, reminderDaysBefore: true },
      }),
      prisma.product.findMany({
        where: { deletedAt: null, warrantyEndDate: { gte: now, lte: horizon } },
        select: { id: true, description: true, warrantyEndDate: true, reminderDaysBefore: true },
      }),
      prisma.vehicle.findMany({
        where: {
          deletedAt: null,
          OR: [{ regoExpiry: { gte: now, lte: horizon } }, { insuranceExpiry: { gte: now, lte: horizon } }],
        },
        select: {
          id: true,
          label: true,
          regoExpiry: true,
          insuranceExpiry: true,
          reminderDaysBefore: true,
        },
      }),
    ]);

    async function checkOne(params: {
      ownerType: NotificationOwnerType;
      ownerId: string;
      field?: string;
      targetDate: Date | null;
      reminderDaysBefore: string | null;
      title: string;
      href: string;
    }) {
      const thresholds = parseThresholds(params.reminderDaysBefore, defaultDays);
      if (thresholds.length === 0) {
        uncovered.push({
          ownerType: params.ownerType,
          title: params.title,
          href: params.href,
          reason: "No reminder thresholds set",
        });
        return;
      }
      const health = await getReminderHealth(params);
      const failedAfterLastSent =
        health.lastFailure && (!health.lastSent || health.lastFailure.sentAt > health.lastSent.sentAt);
      if (failedAfterLastSent) {
        uncovered.push({
          ownerType: params.ownerType,
          title: params.title,
          href: params.href,
          reason: "Last delivery attempt failed",
        });
      }
    }

    for (const c of contracts) {
      await checkOne({
        ownerType: "CONTRACT",
        ownerId: c.id,
        targetDate: c.endDate,
        reminderDaysBefore: c.reminderDaysBefore,
        title: c.title,
        href: `/contracts/${c.id}`,
      });
    }
    for (const p of products) {
      await checkOne({
        ownerType: "PRODUCT",
        ownerId: p.id,
        targetDate: p.warrantyEndDate,
        reminderDaysBefore: p.reminderDaysBefore,
        title: p.description,
        href: `/products/${p.id}`,
      });
    }
    for (const v of vehicles) {
      if (v.regoExpiry && v.regoExpiry >= now && v.regoExpiry <= horizon) {
        await checkOne({
          ownerType: "VEHICLE",
          ownerId: v.id,
          field: "regoExpiry",
          targetDate: v.regoExpiry,
          reminderDaysBefore: v.reminderDaysBefore,
          title: `${v.label} — Registration`,
          href: `/vehicles/${v.id}`,
        });
      }
      if (v.insuranceExpiry && v.insuranceExpiry >= now && v.insuranceExpiry <= horizon) {
        await checkOne({
          ownerType: "VEHICLE",
          ownerId: v.id,
          field: "insuranceExpiry",
          targetDate: v.insuranceExpiry,
          reminderDaysBefore: v.reminderDaysBefore,
          title: `${v.label} — Insurance`,
          href: `/vehicles/${v.id}`,
        });
      }
    }
  }

  return {
    channels: { email: emailEnabled, ntfy: ntfyEnabled, webhook: webhookEndpoints.length > 0 },
    deliveryReady,
    recentSent,
    recentFailed,
    lastActivityAt: lastLog?.sentAt ?? null,
    uncovered,
  };
}
