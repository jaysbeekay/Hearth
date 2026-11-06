import webpush from "web-push";
import { prisma } from "@/lib/prisma";
import { getAppSettings, setAppSetting } from "@/lib/appSettings";
import { env, isAppUrlConfigured } from "@/lib/env";
import { assertSafeOutboundUrl } from "@/lib/net/outbound";
import { buildPushReminder, type ReminderInput } from "@/lib/notifications/reminderContent";

// #375 — Web Push: each member's own devices, no external account. Keys are
// generated once and kept in app settings (the private key encrypted with
// ENCRYPTION_KEY when that's set, like every other secret there).

const PUBLIC_KEY = "push.vapidPublicKey";
const PRIVATE_KEY = "push.vapidPrivateKey";

let generating: Promise<{ publicKey: string; privateKey: string }> | null = null;

export async function getVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const s = await getAppSettings([PUBLIC_KEY, PRIVATE_KEY]);
  if (s[PUBLIC_KEY] && s[PRIVATE_KEY]) return { publicKey: s[PUBLIC_KEY], privateKey: s[PRIVATE_KEY] };
  // One generation per process; the scheduler and a page render can race here.
  generating ??= (async () => {
    const keys = webpush.generateVAPIDKeys();
    await setAppSetting(PRIVATE_KEY, keys.privateKey);
    await setAppSetting(PUBLIC_KEY, keys.publicKey);
    return keys;
  })().finally(() => {
    generating = null;
  });
  return generating;
}

export async function getVapidPublicKey(): Promise<string> {
  return (await getVapidKeys()).publicKey;
}

async function vapidSubject(): Promise<string> {
  if (env.vapidSubject) return env.vapidSubject;
  if (isAppUrlConfigured() && env.appUrl.startsWith("https://")) return env.appUrl;
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    orderBy: { createdAt: "asc" },
    select: { email: true },
  });
  return `mailto:${admin?.email ?? "admin@localhost"}`;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Rejects endpoints that aren't https or point at metadata/blocked hosts. */
export async function assertPushEndpoint(endpoint: string): Promise<void> {
  const url = await assertSafeOutboundUrl(endpoint);
  if (url.protocol !== "https:") throw new Error("Push endpoints must use https.");
}

type Target = { id: string; endpoint: string; p256dh: string; auth: string; user: { dateFormat: string | null } };

const GONE = new Set([404, 410]);

/**
 * Sends one payload per subscription. A subscription the push service says
 * is gone is deleted; other failures are kept on the row for the health card.
 * Throws only when nothing was delivered, so one dead phone doesn't make the
 * scheduler retry (and re-notify) every working device.
 */
async function sendToTargets(targets: Target[], payload: (t: Target) => object): Promise<number> {
  if (targets.length === 0) throw new Error("No devices have push notifications turned on.");
  const keys = await getVapidKeys();
  const subject = await vapidSubject();
  const errors: string[] = [];
  let delivered = 0;

  for (const t of targets) {
    try {
      await assertPushEndpoint(t.endpoint);
      await webpush.sendNotification(
        { endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
        JSON.stringify(payload(t)),
        { vapidDetails: { subject, publicKey: keys.publicKey, privateKey: keys.privateKey }, TTL: 24 * 60 * 60, timeout: 10_000 },
      );
      delivered += 1;
      await prisma.pushSubscription.update({ where: { id: t.id }, data: { lastSuccessAt: new Date(), lastError: null } });
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status != null && GONE.has(status)) {
        await prisma.pushSubscription.deleteMany({ where: { id: t.id } });
        continue;
      }
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
      await prisma.pushSubscription.update({
        where: { id: t.id },
        data: { lastFailureAt: new Date(), lastError: message.slice(0, 500) },
      });
    }
  }
  if (delivered === 0) throw new Error(errors[0] ?? "Every device's push subscription has expired.");
  return delivered;
}

const SELECT = { id: true, endpoint: true, p256dh: true, auth: true, user: { select: { dateFormat: true } } } as const;

/** A Reminder to every subscribed device, in each owner's own date format. */
export async function sendPushReminder(input: Omit<ReminderInput, "dateFormat">): Promise<number> {
  const targets = await prisma.pushSubscription.findMany({ select: SELECT });
  return sendToTargets(targets, (t) => buildPushReminder({ ...input, dateFormat: t.user.dateFormat }));
}

/** A test to one member's own devices: their record's real Reminder, or a plain test. */
export async function sendTestPush(userId: string, input?: Omit<ReminderInput, "dateFormat">): Promise<number> {
  const targets = await prisma.pushSubscription.findMany({ where: { userId }, select: SELECT });
  return sendToTargets(targets, (t) =>
    input
      ? buildPushReminder({ ...input, dateFormat: t.user.dateFormat })
      : { title: "Hearth test notification", body: "Reminders will show up on this device.", url: "/settings", tag: "hearth-test" },
  );
}
