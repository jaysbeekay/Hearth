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

/**
 * The notifications to schedule: each Reminder at REMINDER_HOUR local time
 * on its day, dropping any whose time has already gone.
 */
export function notificationsFor(reminders: DeviceReminder[], now: Date): LocalNotificationSchema[] {
  return reminders.flatMap((r) => {
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
  });
}

/** Cancels what this page scheduled. "On" is kept, so the member's next visit schedules again. */
export async function cancelDeviceReminders(): Promise<void> {
  if (!deviceRemindersAvailable()) return;
  const ids = storedIds();
  if (ids.length > 0) await localNotifications().cancel({ notifications: ids.map((id) => ({ id })) });
  write(IDS_KEY, null);
}

/** Asks for notification permission. Whether it's granted. */
export async function allowDeviceNotifications(): Promise<boolean> {
  const ln = localNotifications();
  if ((await ln.checkPermissions()).display === "granted") return true;
  return (await ln.requestPermissions()).display === "granted";
}

/**
 * Replaces this page's scheduled Reminders with `reminders`, for `userId`.
 * The number scheduled.
 */
export async function scheduleDeviceReminders(userId: string, reminders: DeviceReminder[]): Promise<number> {
  const ln = localNotifications();
  await ln
    .createChannel({ id: CHANNEL_ID, name: "Hearth reminders", description: "Reminders before things come due.", importance: 4, visibility: 1 })
    .catch(() => {});
  await cancelDeviceReminders();
  const notifications = notificationsFor(reminders, new Date());
  if (notifications.length > 0) await ln.schedule({ notifications });
  write(IDS_KEY, JSON.stringify(notifications.map((n) => n.id)));
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
