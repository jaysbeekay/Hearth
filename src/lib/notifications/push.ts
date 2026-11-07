import webpush from "web-push";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { encodeAppSetting } from "@/lib/appSettings";
import { decryptSecret } from "@/lib/crypto";
import { env, isAppUrlConfigured } from "@/lib/env";
import { assertSafeOutboundUrl, safeFetch, UnsafeOutboundUrlError } from "@/lib/net/outbound";
import { buildPushReminder, type ReminderInput } from "@/lib/notifications/reminderContent";
import { pushDeviceFailing } from "@/lib/notifications/pushStatus";

// #375 — Web Push: each member's own devices, no external account. Keys are
// generated once and kept in app settings (the private key encrypted with
// ENCRYPTION_KEY when that's set, like every other secret there).

const PUBLIC_KEY = "push.vapidPublicKey";
const PRIVATE_KEY = "push.vapidPrivateKey";

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

let cachedKeys: VapidKeys | null = null;

/**
 * The stored keys, or null when none were ever made. Unlike getAppSettings(),
 * a database error or a private key that won't decrypt (ENCRYPTION_KEY
 * changed) throws: treating either as "no keys" would make new ones and
 * silently break every subscribed device.
 */
async function readVapidKeys(): Promise<VapidKeys | null> {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: [PUBLIC_KEY, PRIVATE_KEY] } } });
  const publicRow = rows.find((r) => r.key === PUBLIC_KEY);
  const privateRow = rows.find((r) => r.key === PRIVATE_KEY);
  if (!publicRow?.value && !privateRow?.value) return null;
  if (!publicRow?.value || !privateRow?.value) {
    throw new Error("Only one of the Web Push keys is stored. Delete both push.vapid* app settings to start over.");
  }
  let privateKey: string;
  try {
    privateKey = privateRow.encrypted ? decryptSecret(privateRow.value) : privateRow.value;
  } catch {
    throw new Error("The Web Push private key can't be decrypted. Has ENCRYPTION_KEY changed?");
  }
  return { publicKey: publicRow.value, privateKey };
}

function isUniqueClash(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function getVapidKeys(): Promise<VapidKeys> {
  if (cachedKeys) return cachedKeys;
  let keys = await readVapidKeys();
  if (!keys) {
    const fresh = webpush.generateVAPIDKeys();
    try {
      // Create-only, both rows or neither: if another process got there
      // first, its keys win and are read back below.
      await prisma.$transaction([
        prisma.appSetting.create({ data: { key: PUBLIC_KEY, value: fresh.publicKey, encrypted: false } }),
        prisma.appSetting.create({ data: { key: PRIVATE_KEY, ...encodeAppSetting(PRIVATE_KEY, fresh.privateKey) } }),
      ]);
    } catch (error) {
      if (!isUniqueClash(error)) throw error;
    }
    keys = await readVapidKeys();
    if (!keys) throw new Error("Couldn't store the Web Push keys.");
  }
  cachedKeys = keys;
  return keys;
}

/** The public key for the Settings toggle, or null when push can't work here. */
export async function getVapidPublicKey(): Promise<string | null> {
  try {
    return (await getVapidKeys()).publicKey;
  } catch (error) {
    console.error("[push] VAPID keys unavailable:", error);
    return null;
  }
}

/** VAPID_SUBJECT must be a mailto: or https: URL; anything else is ignored. */
export function validVapidSubject(value: string | undefined): string | null {
  if (!value) return null;
  return /^mailto:\S+@\S+$/.test(value) || /^https:\/\/\S+$/.test(value) ? value : null;
}

let warnedSubject = false;
let cachedSubject: { value: string; until: number } | null = null;

// Without VAPID_SUBJECT or an https APP_URL, the first admin's email is the
// contact push services see. Cached briefly: it's read once per Reminder.
async function vapidSubject(): Promise<string> {
  if (cachedSubject && cachedSubject.until > Date.now()) return cachedSubject.value;
  const value = await resolveVapidSubject();
  cachedSubject = { value, until: Date.now() + 5 * 60 * 1000 };
  return value;
}

async function resolveVapidSubject(): Promise<string> {
  const configured = validVapidSubject(env.vapidSubject);
  if (configured) return configured;
  if (env.vapidSubject && !warnedSubject) {
    warnedSubject = true;
    console.warn("[push] VAPID_SUBJECT must start with mailto: or https://; ignoring it.");
  }
  if (isAppUrlConfigured() && env.appUrl.startsWith("https://")) return env.appUrl;
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    orderBy: { createdAt: "asc" },
    select: { email: true },
  });
  return `mailto:${admin?.email ?? "admin@localhost"}`;
}

/**
 * Push endpoints come from any member's browser, not from an admin, so the
 * operator's own network is never a valid target: real push services are
 * public. Also rejects non-https and cloud-metadata hosts.
 */
export async function assertPushEndpoint(endpoint: string): Promise<void> {
  let url: URL;
  try {
    url = await assertSafeOutboundUrl(endpoint, { allowLocal: false });
  } catch (error) {
    // The guard's own wording is about BLOCK_PRIVATE_NETWORK_TARGETS, which
    // doesn't apply here: push never goes to a private address.
    if (error instanceof UnsafeOutboundUrlError) {
      throw new Error("The push endpoint isn't a public address (it's private, local or cloud metadata).");
    }
    throw error;
  }
  if (url.protocol !== "https:") throw new Error("Push endpoints must use https.");
}

type Target = {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  user: { dateFormat: string | null };
};

const GONE = new Set([404, 410]);
const DAY_MS = 24 * 60 * 60 * 1000;
/** A device failing this long, with no success since, is dropped whatever the error. */
const GIVE_UP_AFTER_MS = 30 * DAY_MS;

class PushSendError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
  }
}

/**
 * One encrypted push through safeFetch: a total timeout, a capped response
 * body and no redirects, so a slow or hostile endpoint can't hold up the
 * scheduler or redirect it elsewhere.
 */
async function deliver(t: Target, payload: string, vapid: VapidKeys & { subject: string }): Promise<void> {
  await assertPushEndpoint(t.endpoint);
  const request = webpush.generateRequestDetails({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, payload, {
    vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
    TTL: DAY_MS / 1000,
  });
  const { response, body } = await safeFetch(
    request.endpoint,
    { method: request.method, headers: request.headers, body: request.body ? new Uint8Array(request.body) : null, redirect: "manual" },
    // Push services answer with an empty or tiny body; the cap only stops a
    // hostile endpoint streaming without end.
    { allowLocal: false, timeoutMs: 10_000, maxBytes: 64 * 1024 },
  );
  if (response.status < 200 || response.status > 299) {
    throw new PushSendError(`${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`, response.status);
  }
}

/**
 * Sends one payload per subscription. A subscription the push service says
 * is gone, or that has failed for 30 days straight, is deleted; other
 * failures are kept on the row for the health card. Throws only when nothing
 * was delivered, so one dead phone doesn't make the scheduler retry (and
 * re-notify) every working device. The thrown message is generic: the detail
 * stays on the device row, since a member chose the endpoint.
 */
async function sendToTargets(targets: Target[], payload: (t: Target) => object): Promise<number> {
  if (targets.length === 0) throw new Error("No devices have push notifications turned on.");
  let keys: VapidKeys;
  try {
    keys = await getVapidKeys();
  } catch (error) {
    // The detail is for the admin's log, not the member who pressed Send test.
    console.error("[push] VAPID keys unavailable:", error);
    throw new Error("Push isn't available on this server right now.");
  }
  const vapid = { ...keys, subject: await vapidSubject() };
  let delivered = 0;
  let failed = 0;

  for (const t of targets) {
    const now = new Date();
    try {
      // userId: the service worker shows a Reminder's content only while
      // that member is signed in on the browser (pushGate.ts).
      await deliver(t, JSON.stringify({ ...payload(t), userId: t.userId }), vapid);
    } catch (error) {
      failed += 1;
      const status = error instanceof PushSendError ? error.statusCode : undefined;
      // lastFailureAt is when the current run of failures began.
      const failingSince = pushDeviceFailing(t) && t.lastFailureAt ? t.lastFailureAt : now;
      if ((status != null && GONE.has(status)) || now.getTime() - failingSince.getTime() > GIVE_UP_AFTER_MS) {
        await prisma.pushSubscription.deleteMany({ where: { id: t.id } });
      } else {
        const message = error instanceof Error ? error.message : String(error);
        // updateMany: the row may have been removed while this was sending.
        await prisma.pushSubscription.updateMany({
          where: { id: t.id },
          data: { lastFailureAt: failingSince, lastError: message.slice(0, 500) },
        });
      }
      continue;
    }
    delivered += 1;
    await prisma.pushSubscription.updateMany({ where: { id: t.id }, data: { lastSuccessAt: now, lastError: null } });
  }
  if (delivered === 0) {
    throw new Error(
      failed === 1 ? "The device's push service didn't accept it." : `None of the ${failed} devices' push services accepted it.`,
    );
  }
  return delivered;
}

const SELECT = {
  id: true,
  userId: true,
  endpoint: true,
  p256dh: true,
  auth: true,
  lastSuccessAt: true,
  lastFailureAt: true,
  user: { select: { dateFormat: true } },
} as const;

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

/** For tests: forget the in-process key and subject caches. */
export function resetPushCaches(): void {
  cachedKeys = null;
  cachedSubject = null;
}
