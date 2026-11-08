import { prisma } from "@/lib/prisma";
import { getHouseholdToday, getReminderConfig } from "@/lib/appSettings";
import { addDays, daysBetween, type CalendarDay, type DueEntry } from "@/lib/duePolicy";
import { buildPushReminder } from "@/lib/notifications/reminderContent";
import { plannedReminderRecords } from "@/lib/notifications/reminderRecords";
import type { ReminderPlan } from "@/lib/notifications/reminderSchedule";

// #375 — Reminders the phone app schedules on the device itself, where its
// WebView has no Web Push. The app asks for the days ahead each time it
// opens and replaces what it had scheduled, so a moved date, a Snooze or a
// renewal shows up the next time the member opens Hearth.

/** How far ahead the app schedules. */
export const DEVICE_REMINDER_HORIZON_DAYS = 120;
/**
 * How many the server sends. The app keeps at most 60 (iOS allows 64
 * pending), counted after it drops any whose time today has gone, so a few
 * spare here keep those from cutting into the days ahead.
 */
export const DEVICE_REMINDER_FETCH_LIMIT = 80;

export interface DeviceReminderDay {
  entry: DueEntry;
  thresholdDays: number;
  day: CalendarDay;
}

/**
 * The days from `today` to `today + horizonDays` on which a record's
 * Reminders fall, one per threshold. Unlike the server's channels there's no
 * catch-up: a threshold already passed when the member turned this on gives
 * nothing, and the next one is what reminds. Empty while the record is held
 * for review or Snoozed (the plan has no entries then); the next sync after
 * that ends picks it up.
 */
export function upcomingReminderDays(plan: ReminderPlan, today: CalendarDay, horizonDays: number): DeviceReminderDay[] {
  const until = addDays(today, horizonDays);
  return plan.entries.flatMap(({ entry }) =>
    plan.thresholds
      .map((thresholdDays) => ({ entry, thresholdDays, day: addDays(entry.date, -thresholdDays) }))
      .filter(({ day }) => day >= today && day <= until),
  );
}

/** One Reminder for the app to schedule: a household day, and what it says. */
export interface DeviceReminder {
  /** Stable for the same record, date and threshold, so the app can tell them apart. */
  key: string;
  day: CalendarDay;
  title: string;
  body: string;
  /** A path on this server, as Web Push uses. */
  url: string;
}

/**
 * The household's Reminders over the next DEVICE_REMINDER_HORIZON_DAYS, soonest
 * first, worded as Web Push words them (no tenant names) in the member's own
 * date format. Household-wide, like every other channel.
 */
export async function deviceReminderSchedule(userId: string): Promise<DeviceReminder[]> {
  const [{ defaultDays }, today, user] = await Promise.all([
    getReminderConfig(),
    getHouseholdToday(),
    prisma.user.findUnique({ where: { id: userId }, select: { dateFormat: true } }),
  ]);
  const records = await plannedReminderRecords({ today, defaultReminderDays: defaultDays });
  const reminders = records.flatMap(({ ownerType, ownerId, plan, content }) =>
    upcomingReminderDays(plan, today, DEVICE_REMINDER_HORIZON_DAYS).map(({ entry, thresholdDays, day }) => {
      const { title, body, url } = buildPushReminder({
        ...content(entry),
        // On the day it shows, the Reminder counts from that day.
        daysRemaining: entry.daysLeft - daysBetween(today, day),
        dateFormat: user?.dateFormat ?? null,
        appUrl: null,
      });
      return { key: `${ownerType}:${ownerId}:${entry.field}:${entry.date}:${thresholdDays}`, day, title, body, url };
    }),
  );
  return reminders.sort((a, b) => a.day.localeCompare(b.day) || a.key.localeCompare(b.key)).slice(0, DEVICE_REMINDER_FETCH_LIMIT);
}
