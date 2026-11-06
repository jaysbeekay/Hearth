"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertPushEndpoint, sendTestPush } from "@/lib/notifications/push";
import { pushDeviceIdSchema, pushEndpointSchema, pushSubscriptionSchema } from "@/lib/validation/push";

export type PushActionState = { error?: string; success?: string } | null;

// #375 — turning push on or off on this device. Any signed-in member,
// read-only ones too: getting Reminders changes no household record.
async function requireSignedIn() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in");
  return session.user;
}

export async function savePushSubscription(input: unknown): Promise<PushActionState> {
  const user = await requireSignedIn();
  const parsed = pushSubscriptionSchema.safeParse(input);
  if (!parsed.success) return { error: "This browser gave an invalid push subscription." };
  const { endpoint, keys, deviceLabel } = parsed.data;
  try {
    await assertPushEndpoint(endpoint);
  } catch {
    return { error: "This browser's push service isn't reachable from the server." };
  }
  // The endpoint identifies the device: a device that changes hands moves to
  // whoever turned push on last.
  const data = { userId: user.id, p256dh: keys.p256dh, auth: keys.auth, deviceLabel: deviceLabel || null };
  await prisma.pushSubscription.upsert({ where: { endpoint }, create: { endpoint, ...data }, update: data });
  revalidatePath("/settings");
  return { success: "Reminders will show up on this device." };
}

export async function removePushSubscription(input: unknown): Promise<PushActionState> {
  const user = await requireSignedIn();
  const parsed = pushEndpointSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid push subscription." };
  // Only the caller's own row: one member can't switch off another's device.
  await prisma.pushSubscription.deleteMany({ where: { endpoint: parsed.data.endpoint, userId: user.id } });
  revalidatePath("/settings");
  return { success: "Push reminders are off on this device." };
}

/** One of the caller's other devices, e.g. a lost phone, from Settings. */
export async function removePushDevice(input: unknown): Promise<PushActionState> {
  const user = await requireSignedIn();
  const parsed = pushDeviceIdSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid device." };
  const { count } = await prisma.pushSubscription.deleteMany({ where: { id: parsed.data.id, userId: user.id } });
  revalidatePath("/settings");
  return count > 0 ? { success: "Device removed." } : { error: "That device is already gone." };
}

export async function sendPushTest(): Promise<PushActionState> {
  const user = await requireSignedIn();
  try {
    const delivered = await sendTestPush(user.id);
    return { success: `Test sent to ${delivered} ${delivered === 1 ? "device" : "devices"}.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Couldn't send a test notification." };
  }
}
