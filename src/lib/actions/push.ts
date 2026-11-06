"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertPushEndpoint, sendTestPush } from "@/lib/notifications/push";
import { pushEndpointSchema, pushSubscriptionSchema } from "@/lib/validation/push";

export type PushActionState = { error?: string; success?: string } | null;

// #375 — turning push on or off on this device. Any signed-in member,
// read-only ones too: getting Reminders changes no household record.
async function signedInUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

const NOT_SIGNED_IN = { error: "You're signed out. Sign in again to change push reminders." } as const;

/**
 * "Notify this device": saves the browser's new subscription. The endpoint
 * identifies the device, so one another member saved moves to the caller only
 * when the keys match too, i.e. it really is the same browser; knowing an
 * endpoint isn't enough to take it over. `previousEndpoint` is the
 * subscription this browser just replaced, dropped so it isn't left behind
 * as a second device.
 */
export async function savePushSubscription(input: unknown): Promise<PushActionState> {
  const userId = await signedInUserId();
  if (!userId) return NOT_SIGNED_IN;
  const parsed = pushSubscriptionSchema.safeParse(input);
  if (!parsed.success) return { error: "This browser gave an invalid push subscription." };
  const { endpoint, keys, deviceLabel, previousEndpoint } = parsed.data;
  try {
    await assertPushEndpoint(endpoint);
  } catch {
    return { error: "This browser's push service isn't one the server can send to." };
  }
  const existing = await prisma.pushSubscription.findUnique({ where: { endpoint } });
  if (existing && existing.userId !== userId && (existing.p256dh !== keys.p256dh || existing.auth !== keys.auth)) {
    return { error: "This push subscription belongs to another account." };
  }
  const data = { userId, p256dh: keys.p256dh, auth: keys.auth, deviceLabel: deviceLabel || null };
  await prisma.$transaction([
    ...(previousEndpoint && previousEndpoint !== endpoint
      ? [prisma.pushSubscription.deleteMany({ where: { endpoint: previousEndpoint, userId } })]
      : []),
    prisma.pushSubscription.upsert({ where: { endpoint }, create: { endpoint, ...data }, update: data }),
  ]);
  revalidatePath("/settings");
  return { success: "Reminders will show up on this device." };
}

/**
 * On each Settings visit: keeps this browser's own row current (rotated keys,
 * label). Update-only, so a device removed elsewhere, or one another member
 * turned on, isn't silently re-added or moved to the caller. Returns false
 * when the caller has no row for it, and the toggle then shows push as off.
 */
export async function refreshPushSubscription(input: unknown): Promise<{ registered: boolean }> {
  const userId = await signedInUserId();
  const parsed = pushSubscriptionSchema.safeParse(input);
  if (!userId || !parsed.success) return { registered: false };
  const { endpoint, keys, deviceLabel } = parsed.data;
  const row = await prisma.pushSubscription.findUnique({ where: { endpoint } });
  if (!row || row.userId !== userId) return { registered: false };
  const label = deviceLabel || null;
  if (row.p256dh !== keys.p256dh || row.auth !== keys.auth || row.deviceLabel !== label) {
    await prisma.pushSubscription.updateMany({
      where: { endpoint, userId },
      data: { p256dh: keys.p256dh, auth: keys.auth, deviceLabel: label },
    });
    revalidatePath("/settings");
  }
  return { registered: true };
}

export async function removePushSubscription(input: unknown): Promise<PushActionState> {
  const userId = await signedInUserId();
  if (!userId) return NOT_SIGNED_IN;
  const parsed = pushEndpointSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid push subscription." };
  // Only the caller's own row: one member can't switch off another's device.
  await prisma.pushSubscription.deleteMany({ where: { endpoint: parsed.data.endpoint, userId } });
  revalidatePath("/settings");
  return { success: "Push reminders are off on this device." };
}

export async function sendPushTest(): Promise<PushActionState> {
  const userId = await signedInUserId();
  if (!userId) return NOT_SIGNED_IN;
  try {
    const delivered = await sendTestPush(userId);
    return { success: `Test sent to ${delivered} ${delivered === 1 ? "device" : "devices"}.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Couldn't send a test notification." };
  }
}
