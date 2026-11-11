"use server";

import { auth } from "@/lib/auth";
import { deviceReminderSchedule, type DeviceReminder } from "@/lib/notifications/deviceReminders";

/**
 * #375 — the phone app's Reminders for the days ahead, to schedule on the
 * device. Any signed-in member, read-only ones too: it changes nothing.
 */
export async function getDeviceReminders(): Promise<{ reminders: DeviceReminder[] } | { error: string; signedOut?: true }> {
  const session = await auth();
  // signedOut: the phone cancels what it scheduled (a session ended by a
  // password or role change, or a deleted account, while the app stayed open).
  if (!session?.user?.id) return { error: "You're signed out. Sign in again to turn on reminders.", signedOut: true };
  return { reminders: await deviceReminderSchedule(session.user.id) };
}
