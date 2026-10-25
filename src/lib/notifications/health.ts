import { getReminderConfig, getHouseholdToday } from "@/lib/appSettings";
import { activeChannels, channelList } from "@/lib/notifications/channels";
import { getNotificationLogsByOwner, toSentLogRow } from "@/lib/notifications/logs";
import {
  dayToDate,
  liveFailures,
  REMINDER_CHANNELS,
  reminderPlan,
  type ReminderPlan,
  type ReminderRecord,
} from "@/lib/notifications/reminderSchedule";
import type { DueContext, VehicleDueField } from "@/lib/duePolicy";
import { prisma } from "@/lib/prisma";
import type { NotificationOwnerType } from "@/generated/prisma/enums";
import type { NotificationLog } from "@/generated/prisma/client";

/**
 * When the next Reminder goes out: on the next scheduler check (a catch-up
 * is waiting), or on a future day. Never a day in the past (#381).
 */
export type NextReminder = { kind: "next-check" } | { kind: "on"; date: Date };

export interface ReminderHealth {
  /** True when a Reminder can still go out for this record: it has a Reminder entry and thresholds, and isn't on hold. */
  enabled: boolean;
  /** The record Needs review: its Reminders are held until someone confirms it. */
  onHold: boolean;
  thresholds: number[];
  /** Null when no Reminder is left (or Reminders aren't enabled). */
  nextReminder: NextReminder | null;
  channels: { email: boolean; ntfy: boolean; webhook: boolean };
  deliveryReady: boolean;
  lastSent: { channel: string; thresholdDays: number; sentAt: Date } | null;
  /** The latest failed attempt for the current date that no later send has replaced. */
  lastFailure: { channel: string; thresholdDays: number; sentAt: Date; error: string | null } | null;
}

export type ReminderHealthRecord = ReminderRecord & { extractionPending?: boolean };

type Channels = ReminderHealth["channels"];

const newestFirst = (a: NotificationLog, b: NotificationLog) => b.sentAt.getTime() - a.sentAt.getTime();

// The health of one entry (a Contract's or Warranty's single entry, or one
// of a Vehicle's dates), read off the same Reminder plan the scheduler uses.
function summarize(
  plan: ReminderPlan,
  field: VehicleDueField | undefined,
  logs: NotificationLog[],
  channels: Channels,
): ReminderHealth {
  const planned = field ? plan.entries.find((e) => e.entry.field === field) : plan.entries[0];
  // A Vehicle's card covers one date; a Contract's history spans its notice
  // deadline and end date.
  const ownLogs = field ? logs.filter((l) => l.field === field) : logs;

  let nextReminder: NextReminder | null = null;
  if (planned) {
    // With nothing configured yet, show what would happen once a channel is.
    const considered = channelList(channels);
    const schedules = (considered.length > 0 ? considered : [...REMINDER_CHANNELS]).map((c) => planned.schedule[c]);
    if (schedules.some((s) => s.sendNow != null)) {
      nextReminder = { kind: "next-check" };
    } else {
      const days = schedules.map((s) => s.nextReminderOn).filter((d): d is string => d != null).sort();
      if (days.length > 0) nextReminder = { kind: "on", date: dayToDate(days[0]) };
    }
  }

  const lastSentLog = ownLogs.filter((l) => l.status === "SENT").sort(newestFirst)[0];
  const current = planned
    ? ownLogs.filter((l) => l.field === planned.entry.field && l.dueDate?.getTime() === dayToDate(planned.entry.date).getTime())
    : [];
  const lastFailureLog = liveFailures(current).sort(newestFirst)[0];

  const deliveryReady = channels.email || channels.ntfy || channels.webhook;
  return {
    enabled: !plan.held && planned != null && plan.thresholds.length > 0,
    onHold: plan.held,
    thresholds: plan.thresholds,
    nextReminder,
    channels,
    deliveryReady,
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

async function loadContext(): Promise<{ ctx: DueContext; channels: Channels }> {
  const [{ defaultDays }, today, { email, ntfy, webhook }] = await Promise.all([
    getReminderConfig(),
    getHouseholdToday(),
    // The channels the scheduler will really send on (#387 review).
    activeChannels(),
  ]);
  return {
    ctx: { today, defaultReminderDays: defaultDays },
    channels: { email, ntfy, webhook },
  };
}

/**
 * Computes the reminder-health block shown on contract/product/vehicle
 * detail pages (#201) — "is a reminder actually going to fire, and did the
 * last one work" rather than just "is a date set". It reads the same
 * Reminder schedule the scheduler sends from (#387), so the two agree.
 */
export async function getReminderHealth(params: {
  ownerType: NotificationOwnerType;
  ownerId: string;
  record: ReminderHealthRecord;
  /** Vehicle only: which of its dates this card is about. */
  field?: VehicleDueField;
}): Promise<ReminderHealth> {
  const [{ ctx, channels }, logsByOwner] = await Promise.all([
    loadContext(),
    getNotificationLogsByOwner(params.ownerType, [params.ownerId]),
  ]);
  const logs = logsByOwner.get(params.ownerId) ?? [];
  const plan = reminderPlan(params.record, ctx, logs.map(toSentLogRow));
  return summarize(plan, params.field, logs, channels);
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
  /** Records with a Reminder entry within 90 days that have no working
   * path to a delivered reminder — only computed when at least one channel
   * is configured, since with none configured every record is equally
   * uncovered for the same one reason. */
  uncovered: UncoveredRecord[];
}

const UNCOVERED_HORIZON_DAYS = 90;

const VEHICLE_FIELD_TITLES: Record<VehicleDueField, string> = {
  regoExpiry: "Registration",
  insuranceExpiry: "Insurance",
  nextServiceDue: "Service",
};

/**
 * Household-wide rollup of the same signals ReminderHealthCard shows per
 * record (#292) — so confirming "reminders are actually working" doesn't
 * require opening every record that happens to be expiring soon. Built on
 * the same Reminder plan as the card and the scheduler.
 */
export async function getHouseholdReminderHealth(): Promise<HouseholdReminderHealth> {
  const { ctx, channels } = await loadContext();
  const deliveryReady = channels.email || channels.ntfy || channels.webhook;

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [recentSent, recentFailed, lastLog] = await Promise.all([
    prisma.notificationLog.count({ where: { status: "SENT", sentAt: { gte: since } } }),
    prisma.notificationLog.count({ where: { status: "FAILED", sentAt: { gte: since } } }),
    prisma.notificationLog.findFirst({ orderBy: { sentAt: "desc" }, select: { sentAt: true } }),
  ]);

  const uncovered: UncoveredRecord[] = [];
  if (deliveryReady) {
    const [contracts, products, vehicles] = await Promise.all([
      prisma.contract.findMany({ where: { status: "ACTIVE", deletedAt: null, endDate: { not: null } } }),
      prisma.product.findMany({ where: { deletedAt: null, warrantyEndDate: { not: null } } }),
      prisma.vehicle.findMany({
        where: {
          deletedAt: null,
          OR: [{ regoExpiry: { not: null } }, { insuranceExpiry: { not: null } }, { nextServiceDue: { not: null } }],
        },
      }),
    ]);
    const [contractLogs, productLogs, vehicleLogs] = await Promise.all([
      getNotificationLogsByOwner("CONTRACT", contracts.map((c) => c.id)),
      getNotificationLogsByOwner("PRODUCT", products.map((p) => p.id)),
      getNotificationLogsByOwner("VEHICLE", vehicles.map((v) => v.id)),
    ]);

    function check(
      ownerType: NotificationOwnerType,
      record: ReminderHealthRecord,
      logs: NotificationLog[],
      title: string,
      href: string,
    ) {
      const plan = reminderPlan(record, ctx, logs.map(toSentLogRow));
      for (const { entry } of plan.entries) {
        if (entry.daysLeft > UNCOVERED_HORIZON_DAYS) continue;
        const field = record.kind === "vehicle" ? (entry.field as VehicleDueField) : undefined;
        const entryTitle = field ? `${title} — ${VEHICLE_FIELD_TITLES[field]}` : title;
        if (plan.thresholds.length === 0) {
          uncovered.push({ ownerType, title: entryTitle, href, reason: "No reminder thresholds set" });
        } else if (summarize(plan, field, logs, channels).lastFailure) {
          uncovered.push({ ownerType, title: entryTitle, href, reason: "Last delivery attempt failed" });
        }
      }
    }

    for (const c of contracts) {
      check("CONTRACT", { kind: "contract", ...c }, contractLogs.get(c.id) ?? [], c.title, `/contracts/${c.id}`);
    }
    for (const p of products) {
      check("PRODUCT", { kind: "warranty", ...p }, productLogs.get(p.id) ?? [], p.description, `/products/${p.id}`);
    }
    for (const v of vehicles) {
      check("VEHICLE", { kind: "vehicle", ...v }, vehicleLogs.get(v.id) ?? [], v.label, `/vehicles/${v.id}`);
    }
  }

  return {
    channels,
    deliveryReady,
    recentSent,
    recentFailed,
    lastActivityAt: lastLog?.sentAt ?? null,
    uncovered,
  };
}
