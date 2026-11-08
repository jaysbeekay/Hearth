import { Capacitor, registerPlugin } from "@capacitor/core";
import type { LocalNotificationSchema, LocalNotificationsPlugin } from "@capacitor/local-notifications";
import type { DeviceReminder } from "@/lib/notifications/deviceReminders";

// #375 — Reminders in the phone app. Its WebView (connected to this server)
// has no Web Push, so the app schedules the household's Reminders for the
// days ahead as local notifications, and replaces them each time it opens.
// Client-only. The standalone shell schedules its own (ios-shell/www/app.js);
// these are tracked separately, by the ids kept here.

/** Which member turned this on, on this device. */
const USER_KEY = "hearth.deviceReminders.user";
/** The ids this page scheduled, so it cancels only its own. */
const IDS_KEY = "hearth.deviceReminders.ids";
const CHANNEL_ID = "hearth-reminders";
/** Local time a Reminder shows on its day, as in the standalone shell. */
const REMINDER_HOUR = 9;

let plugin: LocalNotificationsPlugin | null = null;
function localNotifications(): LocalNotificationsPlugin {
  plugin ??= registerPlugin<LocalNotificationsPlugin>("LocalNotifications");
  return plugin;
}

/** Whether this page runs in the phone app, with its notifications plugin. */
export function deviceRemindersAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("LocalNotifications");
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the Reminders still go; only "on" isn't remembered.
  }
}

/** The member who turned device Reminders on here, or null. */
export function deviceRemindersUser(): string | null {
  return read(USER_KEY);
}

function storedIds(): number[] {
  try {
    const ids: unknown = JSON.parse(read(IDS_KEY) ?? "[]");
    return Array.isArray(ids) ? ids.filter((id): id is number => Number.isInteger(id)) : [];
  } catch {
    return [];
  }
}

/** A positive 31-bit id from a Reminder's key (FNV-1a), as both platforms want. */
export function notificationId(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 1) || 1;
}

/** Only a path on this server opens from a notification. */
export function safeReminderPath(url: unknown): string | null {
  return typeof url === "string" && url.startsWith("/") && !url.startsWith("//") && !url.includes("\\") ? url : null;
}

/** iOS keeps at most 64 pending local notifications per app; leave room. */
export const DEVICE_REMINDER_LIMIT = 60;

/**
 * The notifications to schedule: each Reminder at REMINDER_HOUR local time
 * on its day, dropping any whose time has already gone, then the soonest
 * DEVICE_REMINDER_LIMIT.
 */
export function notificationsFor(reminders: DeviceReminder[], now: Date): LocalNotificationSchema[] {
  return reminders
    .flatMap((r) => {
      const [y, m, d] = r.day.split("-").map(Number);
      const at = new Date(y, m - 1, d, REMINDER_HOUR, 0, 0);
      if (!(at.getTime() > now.getTime())) return [];
      return [
        {
          id: notificationId(`server:${r.key}`),
          title: r.title,
          body: r.body,
          schedule: { at, allowWhileIdle: true },
          channelId: CHANNEL_ID,
          extra: { source: "hearth-server", url: r.url },
        },
      ];
    })
    .slice(0, DEVICE_REMINDER_LIMIT);
}

/**
 * Bumped whenever Reminders here are cancelled or turned off (sign-out,
 * another member, Turn off). A sync started before that doesn't schedule,
 * so a late answer can't put the previous member's Reminders back.
 */
let generation = 0;

/** The current generation, to pass to scheduleDeviceReminders once the fetch is back. */
export function deviceRemindersGeneration(): number {
  return generation;
}

/** Thrown when a sync was overtaken by a cancel or turn-off. */
export class DeviceRemindersSuperseded extends Error {
  constructor() {
    super("Reminders on this phone changed while updating. Try again.");
  }
}

async function cancelIds(ids: number[]): Promise<void> {
  if (ids.length > 0) await localNotifications().cancel({ notifications: ids.map((id) => ({ id })) });
}

/** Cancels what this page scheduled. "On" is kept, so the member's next visit schedules again. */
export async function cancelDeviceReminders(): Promise<void> {
  generation++;
  if (!deviceRemindersAvailable()) return;
  await cancelIds(storedIds());
  write(IDS_KEY, null);
}

/** Asks for notification permission. Whether it's granted. */
export async function allowDeviceNotifications(): Promise<boolean> {
  const ln = localNotifications();
  if ((await ln.checkPermissions()).display === "granted") return true;
  return (await ln.requestPermissions()).display === "granted";
}

/**
 * Replaces this page's scheduled Reminders with `reminders`, for `userId`,
 * if nothing cancelled them since `startedAt` (deviceRemindersGeneration()
 * when the fetch began). The number scheduled.
 *
 * Failure-safe: a Reminder keeps its id from one sync to the next, and
 * scheduling an id again replaces it, so only the ones no longer wanted are
 * cancelled first, then the rest are scheduled over the old. If scheduling
 * fails, what was there stays, and every id is kept for the next cancel.
 */
export async function scheduleDeviceReminders(
  userId: string,
  reminders: DeviceReminder[],
  startedAt: number,
): Promise<number> {
  if (startedAt !== generation) throw new DeviceRemindersSuperseded();
  const ln = localNotifications();
  await ln
    .createChannel({ id: CHANNEL_ID, name: "Hearth reminders", description: "Reminders before things come due.", importance: 4, visibility: 1 })
    .catch(() => {});
  const notifications = notificationsFor(reminders, new Date());
  const ids = notifications.map((n) => n.id);
  const previous = storedIds();
  if (startedAt !== generation) throw new DeviceRemindersSuperseded();
  await cancelIds(previous.filter((id) => !ids.includes(id)));
  // Until the schedule is done, both sets count as this page's.
  write(IDS_KEY, JSON.stringify([...new Set([...previous, ...ids])]));
  if (notifications.length > 0) await ln.schedule({ notifications });
  if (startedAt !== generation) {
    // Cancelled while scheduling: take back what this sync put there.
    await cancelIds(ids);
    throw new DeviceRemindersSuperseded();
  }
  write(IDS_KEY, JSON.stringify(ids));
  write(USER_KEY, userId);
  return notifications.length;
}

/** Turns device Reminders off here. */
export async function turnOffDeviceReminders(): Promise<void> {
  await cancelDeviceReminders();
  write(USER_KEY, null);
}

/** Opens a tapped Reminder's record. Returns a remover. */
export function openTappedReminders(open: (path: string) => void): () => void {
  if (!deviceRemindersAvailable()) return () => {};
  const handle = localNotifications().addListener("localNotificationActionPerformed", ({ notification }) => {
    const extra = notification.extra as { source?: unknown; url?: unknown } | undefined;
    const path = extra?.source === "hearth-server" ? safeReminderPath(extra.url) : null;
    if (path) open(path);
  });
  return () => {
    void handle.then((h) => h.remove());
  };
}
