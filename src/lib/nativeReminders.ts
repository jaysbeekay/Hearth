import { Capacitor, registerPlugin } from "@capacitor/core";
import type { LocalNotificationSchema, LocalNotificationsPlugin } from "@capacitor/local-notifications";
import type { DeviceReminder } from "@/lib/notifications/deviceReminders";

// #375 — Reminders in the phone app. Its WebView (connected to this server)
// has no Web Push, so the app schedules the household's Reminders for the
// days ahead as local notifications, and replaces them each time it opens.
// Client-only. The standalone shell schedules its own (ios-shell/www/app.js);
// these are tracked separately, by the ids kept here and by their
// extra.source tag.

/** Which member turned this on, on this device. */
const USER_KEY = "hearth.deviceReminders.user";
/** The ids this page scheduled, so it cancels only its own. */
const IDS_KEY = "hearth.deviceReminders.ids";
const CHANNEL_ID = "hearth-reminders";
/** Tags every notification this page schedules, so a cancel can find them without storage. */
const SOURCE = "hearth-server";
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
    // Storage blocked: the Reminders still go, but "on" isn't remembered and
    // neither are their ids. A cancel still finds them by their tag
    // (pendingOwnIds).
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

/**
 * A positive 31-bit id from a Reminder's key (FNV-1a), as both platforms want.
 * Two keys hashing alike would share one notification; at 80 keys a sync
 * that's a one-in-millions chance, and the loss is one Reminder.
 */
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
      return [{ r, at }];
    })
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, DEVICE_REMINDER_LIMIT)
    .map(({ r, at }) => ({
      id: notificationId(`server:${r.key}`),
      title: r.title,
      body: r.body,
      schedule: { at, allowWhileIdle: true },
      channelId: CHANNEL_ID,
      extra: { source: SOURCE, url: r.url },
    }));
}

/**
 * Bumped whenever Reminders here are cancelled or turned off (sign-out,
 * another member, Turn off). A sync started before that doesn't schedule,
 * so a late answer can't put the previous member's Reminders back.
 */
let generation = 0;
/** Syncs started, and the newest one whose schedule finished. */
let started = 0;
let committed = 0;

/** Taken when a sync's fetch begins; scheduleDeviceReminders checks it once the fetch is back. */
export interface DeviceReminderSyncTicket {
  readonly generation: number;
  readonly seq: number;
}

export function startDeviceReminderSync(): DeviceReminderSyncTicket {
  return { generation, seq: ++started };
}

function superseded(ticket: DeviceReminderSyncTicket): boolean {
  // Cancelled since, or a sync started later has already scheduled newer data.
  return ticket.generation !== generation || ticket.seq < committed;
}

/** Thrown when a sync was overtaken by a cancel, a turn-off or a newer sync. */
export class DeviceRemindersSuperseded extends Error {
  constructor() {
    super("Reminders on this phone were changed while this update was running.");
  }
}

/**
 * Every native schedule and cancel runs one at a time, in the order asked,
 * so two of them never interleave: an id is never scheduled after the write
 * that would have tracked it, and a cancel always sees every id put there.
 */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

/**
 * The pending notifications this page scheduled, by their tag. Covers ids
 * that never made it into storage (blocked, cleared, a write that failed).
 * Empty if the plugin can't list them; the stored ids still go.
 */
async function pendingOwnIds(): Promise<number[]> {
  try {
    const { notifications } = await localNotifications().getPending();
    return notifications
      .filter((n) => (n.extra as { source?: unknown } | undefined)?.source === SOURCE)
      .map((n) => n.id);
  } catch {
    return [];
  }
}

async function cancelIds(ids: number[]): Promise<void> {
  if (ids.length > 0) await localNotifications().cancel({ notifications: ids.map((id) => ({ id })) });
}

/** Cancels what this page scheduled. "On" is kept, so the member's next visit schedules again. */
export function cancelDeviceReminders(): Promise<void> {
  // Bumped now, not when its turn comes: a sync scheduling ahead of it in
  // the queue sees it, and leaves its ids tracked for this cancel to take.
  generation++;
  if (!deviceRemindersAvailable()) return Promise.resolve();
  return serial(async () => {
    await cancelIds([...new Set([...storedIds(), ...(await pendingOwnIds())])]);
    // Only once they're gone: if the cancel fails, the ids stay for the next one.
    write(IDS_KEY, null);
  });
}

/** Asks for notification permission. Whether it's granted. */
export async function allowDeviceNotifications(): Promise<boolean> {
  const ln = localNotifications();
  if ((await ln.checkPermissions()).display === "granted") return true;
  return (await ln.requestPermissions()).display === "granted";
}

/**
 * Replaces this page's scheduled Reminders with `reminders`, for `userId`,
 * unless `ticket` (startDeviceReminderSync() when the fetch began) has been
 * superseded. The number scheduled.
 *
 * Failure-safe: a Reminder keeps its id from one sync to the next, and
 * scheduling an id again replaces it, so only the ones no longer wanted are
 * cancelled first, then the rest are scheduled over the old. If scheduling
 * fails, every Reminder still wanted stays as it was, and every id is kept
 * for the next cancel.
 */
export function scheduleDeviceReminders(
  userId: string,
  reminders: DeviceReminder[],
  ticket: DeviceReminderSyncTicket,
): Promise<number> {
  return serial(async () => {
    if (superseded(ticket)) throw new DeviceRemindersSuperseded();
    const ln = localNotifications();
    await ln
      .createChannel({ id: CHANNEL_ID, name: "Hearth reminders", description: "Reminders before things come due.", importance: 4, visibility: 1 })
      .catch(() => {});
    const notifications = notificationsFor(reminders, new Date());
    const ids = notifications.map((n) => n.id);
    const previous = storedIds();
    if (superseded(ticket)) throw new DeviceRemindersSuperseded();
    await cancelIds(previous.filter((id) => !ids.includes(id)));
    // Until the schedule is done, both sets count as this page's.
    write(IDS_KEY, JSON.stringify([...new Set([...previous, ...ids])]));
    if (notifications.length > 0) await ln.schedule({ notifications });
    // Cancelled while scheduling: that cancel is queued behind this and takes
    // every id tracked, these included.
    if (superseded(ticket)) throw new DeviceRemindersSuperseded();
    write(IDS_KEY, JSON.stringify(ids));
    write(USER_KEY, userId);
    committed = ticket.seq;
    return notifications.length;
  });
}

/**
 * Turns device Reminders off here. "Off" is written first, so a background
 * sync can't start while the cancel waits its turn and switch them back on.
 * If the cancel fails they're put back "on", since they're still scheduled,
 * so Turn off is still offered.
 */
export async function turnOffDeviceReminders(): Promise<void> {
  const owner = deviceRemindersUser();
  write(USER_KEY, null);
  try {
    await cancelDeviceReminders();
  } catch (error) {
    if (owner && deviceRemindersUser() === null) write(USER_KEY, owner);
    throw error;
  }
}

/** At most one resync an hour when the app comes back into view. */
export const RESYNC_MS = 60 * 60 * 1000;
/** After a failed sync, how soon to try again; doubles each time, up to RESYNC_MS. */
export const RETRY_MS = 60 * 1000;

/**
 * Keeps `userId`'s Reminders here current: syncs now, when the app comes
 * back into view (at most hourly), and soon after a failure, backing off to
 * hourly. A sync overtaken by a cancel or a newer sync isn't retried. Returns
 * a stopper.
 */
export function keepDeviceRemindersCurrent(
  userId: string,
  sync: () => Promise<{ error?: string } | null>,
): () => void {
  /** No sync before this: an hour after a success, the backoff after a failure. */
  let nextAt = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let retryMs = RETRY_MS;
  let stopped = false;
  function failed(error?: unknown) {
    if (error instanceof DeviceRemindersSuperseded) {
      // Not a failure: something else changed them. The next view syncs.
      nextAt = 0;
      return;
    }
    // What was scheduled stays (scheduleDeviceReminders); try again soon
    // rather than in an hour, and not sooner on every return to the app.
    nextAt = Date.now() + retryMs;
    if (stopped || retry) return;
    retry = setTimeout(() => {
      retry = undefined;
      run();
    }, retryMs);
    retryMs = Math.min(retryMs * 2, RESYNC_MS);
  }
  function run() {
    if (stopped || Date.now() < nextAt) return;
    // Turned off or signed out here since: nothing to keep current.
    if (deviceRemindersUser() !== userId) return;
    nextAt = Date.now() + RESYNC_MS;
    sync().then((result) => {
      if (result?.error) failed();
      else retryMs = RETRY_MS;
    }, failed);
  }
  function onVisible() {
    if (document.visibilityState === "visible") run();
  }
  run();
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    stopped = true;
    clearTimeout(retry);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

/** Opens a tapped Reminder's record. Returns a remover. */
export function openTappedReminders(open: (path: string) => void): () => void {
  if (!deviceRemindersAvailable()) return () => {};
  const handle = localNotifications().addListener("localNotificationActionPerformed", ({ notification }) => {
    const extra = notification.extra as { source?: unknown; url?: unknown } | undefined;
    const path = extra?.source === SOURCE ? safeReminderPath(extra.url) : null;
    if (path) open(path);
  });
  return () => {
    void handle.then((h) => h.remove());
  };
}
