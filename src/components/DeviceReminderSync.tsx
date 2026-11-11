"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { syncDeviceReminders } from "@/components/DeviceReminderToggle";
import {
  claimDeviceReminders,
  deviceRemindersAvailable,
  keepDeviceRemindersCurrent,
  openTappedReminders,
} from "@/lib/nativeReminders";

/**
 * #375 — in the phone app, keeps the Reminders scheduled on the device
 * current: on each app open and when it comes back into view, for the member
 * who turned them on. Another member signed in here turns them off, and any
 * left that nothing remembers are cancelled (claimDeviceReminders). A tapped
 * Reminder opens its record.
 *
 * The keeper runs even when this member hasn't turned them on: it syncs only
 * while they're on for this member, so turning them on mid-session ("Notify
 * this phone") is kept current from the next return to the app, without
 * waiting for the app to restart.
 */
export function DeviceReminderSync({ userId }: { userId: string }) {
  const router = useRouter();

  useEffect(() => {
    if (!deviceRemindersAvailable()) return;
    claimDeviceReminders(userId);
    return keepDeviceRemindersCurrent(userId, () => syncDeviceReminders(userId));
  }, [userId]);

  useEffect(() => openTappedReminders((path) => router.push(path)), [router]);

  return null;
}
