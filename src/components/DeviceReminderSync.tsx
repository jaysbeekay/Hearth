"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { syncDeviceReminders } from "@/components/DeviceReminderToggle";
import {
  deviceRemindersAvailable,
  deviceRemindersUser,
  keepDeviceRemindersCurrent,
  openTappedReminders,
  turnOffDeviceReminders,
} from "@/lib/nativeReminders";

/**
 * #375 — in the phone app, keeps the Reminders scheduled on the device
 * current: on each app open and when it comes back into view, for the member
 * who turned them on. Another member signed in here turns them off. A tapped
 * Reminder opens its record.
 */
export function DeviceReminderSync({ userId }: { userId: string }) {
  const router = useRouter();

  useEffect(() => {
    if (!deviceRemindersAvailable()) return;
    const owner = deviceRemindersUser();
    if (owner && owner !== userId) {
      void turnOffDeviceReminders().catch(() => {});
      return;
    }
    if (owner !== userId) return;
    return keepDeviceRemindersCurrent(userId, () => syncDeviceReminders(userId));
  }, [userId]);

  useEffect(() => openTappedReminders((path) => router.push(path)), [router]);

  return null;
}
