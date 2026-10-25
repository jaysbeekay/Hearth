import { prisma } from "@/lib/prisma";
import type { NotificationChannel, NotificationOwnerType, NotificationStatus } from "@/generated/prisma/enums";
import type { NotificationLog } from "@/generated/prisma/client";
import { ensureNotificationLogBackfill } from "@/lib/notifications/logBackfill";
import { dateToDay, type SentLogRow } from "@/lib/notifications/reminderSchedule";

/**
 * Bulk-fetches notification logs for a batch of owners of one type, grouped
 * by ownerId — used by the scheduler to avoid an N+1 query per contract/
 * product/vehicle. "Already notified" (#201) should only ever mean a SENT
 * row; a FAILED row for a threshold leaves it eligible for retry.
 *
 * Runs the one-off post-upgrade backfill first (#387), so no caller ever
 * decides anything from rows that haven't been dated yet.
 */
export async function getNotificationLogsByOwner(
  ownerType: NotificationOwnerType,
  ownerIds: string[],
): Promise<Map<string, NotificationLog[]>> {
  await ensureNotificationLogBackfill();
  const map = new Map<string, NotificationLog[]>();
  if (ownerIds.length === 0) return map;

  const rows = await prisma.notificationLog.findMany({
    where: { ownerType, ownerId: { in: ownerIds } },
  });
  for (const row of rows) {
    const list = map.get(row.ownerId) ?? [];
    list.push(row);
    map.set(row.ownerId, list);
  }
  return map;
}

/** A log row as the Reminder schedule reads it. */
export function toSentLogRow(row: NotificationLog): SentLogRow {
  return {
    field: row.field,
    channel: row.channel,
    thresholdDays: row.thresholdDays,
    dueDate: row.dueDate ? dateToDay(row.dueDate) : null,
    status: row.status,
  };
}

/**
 * Records the outcome of one send attempt. Upserts on the
 * (ownerType, ownerId, field, channel, thresholdDays, dueDate) key so a
 * later successful retry overwrites an earlier FAILED row for the same
 * threshold and date, rather than erroring on the unique constraint — this
 * is what makes reminder failures visible (#201) without changing the
 * retry cadence (a threshold with no SENT row for the entry's current date
 * is retried every scheduler run).
 */
export async function recordNotificationOutcome(params: {
  ownerType: NotificationOwnerType;
  ownerId: string;
  /** The Due entry's field: "noticeDeadline", "endDate", "warrantyEndDate", "regoExpiry", … */
  field: string;
  /** The Due entry's date (UTC midnight) the Reminder was for (ADR 0003). */
  dueDate: Date;
  channel: NotificationChannel;
  thresholdDays: number;
  status: NotificationStatus;
  error?: string;
}): Promise<void> {
  const sentAt = new Date();
  const key = {
    ownerType: params.ownerType,
    ownerId: params.ownerId,
    field: params.field,
    channel: params.channel,
    thresholdDays: params.thresholdDays,
    dueDate: params.dueDate,
  };
  await prisma.notificationLog.upsert({
    where: { ownerType_ownerId_field_channel_thresholdDays_dueDate: key },
    create: { ...key, status: params.status, error: params.error ?? null, sentAt },
    update: { status: params.status, error: params.error ?? null, sentAt },
  });
}

/**
 * Clears every log row for an owner. Only for permanent delete: a date
 * change needs nothing, since rows for an earlier date simply stop counting
 * (ADR 0003).
 */
export async function clearNotificationLogs(ownerType: NotificationOwnerType, ownerId: string): Promise<void> {
  await prisma.notificationLog.deleteMany({ where: { ownerType, ownerId } });
}
