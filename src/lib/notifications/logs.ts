import { prisma } from "@/lib/prisma";
import type { NotificationChannel, NotificationOwnerType, NotificationStatus } from "@/generated/prisma/enums";
import type { NotificationLog } from "@/generated/prisma/client";

/**
 * Bulk-fetches notification logs for a batch of owners of one type, grouped
 * by ownerId — used by the scheduler to avoid an N+1 query per contract/
 * product/vehicle. "Already notified" (#201) should only ever mean a SENT
 * row; a FAILED row for a threshold leaves it eligible for retry.
 */
export async function getNotificationLogsByOwner(
  ownerType: NotificationOwnerType,
  ownerIds: string[],
): Promise<Map<string, NotificationLog[]>> {
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

/**
 * Records the outcome of one send attempt. Upserts on the
 * (ownerType, ownerId, field, channel, thresholdDays) key so a later
 * successful retry overwrites an earlier FAILED row for the same threshold,
 * rather than erroring on the unique constraint — this is what makes
 * reminder failures visible (#201) without changing the existing retry
 * cadence (a threshold with no SENT row is retried every scheduler run,
 * exactly as before this record was ever persisted).
 */
export async function recordNotificationOutcome(params: {
  ownerType: NotificationOwnerType;
  ownerId: string;
  /** Vehicle only — "regoExpiry" | "insuranceExpiry". Omit for contract/product. */
  field?: string;
  channel: NotificationChannel;
  thresholdDays: number;
  status: NotificationStatus;
  error?: string;
}): Promise<void> {
  const field = params.field ?? "";
  const sentAt = new Date();
  await prisma.notificationLog.upsert({
    where: {
      ownerType_ownerId_field_channel_thresholdDays: {
        ownerType: params.ownerType,
        ownerId: params.ownerId,
        field,
        channel: params.channel,
        thresholdDays: params.thresholdDays,
      },
    },
    create: {
      ownerType: params.ownerType,
      ownerId: params.ownerId,
      field,
      channel: params.channel,
      thresholdDays: params.thresholdDays,
      status: params.status,
      error: params.error ?? null,
      sentAt,
    },
    update: {
      status: params.status,
      error: params.error ?? null,
      sentAt,
    },
  });
}

/** Clears all logged thresholds for an owner — used when its reminder date changes, so reminders can re-fire against the new date. */
export async function clearNotificationLogs(ownerType: NotificationOwnerType, ownerId: string): Promise<void> {
  await prisma.notificationLog.deleteMany({ where: { ownerType, ownerId } });
}
