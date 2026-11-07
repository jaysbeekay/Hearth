"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { syncDeviceReminders } from "@/components/DeviceReminderToggle";
import {
  deviceRemindersAvailable,
  deviceRemindersUser,
  openTappedReminders,
  turnOffDeviceReminders,
} from "@/lib/nativeReminders";

/** At most one resync an hour when the app comes back into view. */
const RESYNC_MS = 60 * 60 * 1000;

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
    let last = 0;
    function sync() {
      if (Date.now() - last < RESYNC_MS) return;
      last = Date.now();
      // A failed sync keeps what was scheduled; the next one tries again.
      void syncDeviceReminders(userId).catch(() => {});
    }
    function onVisible() {
      if (document.visibilityState === "visible") sync();
    }
    sync();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [userId]);

  useEffect(() => openTappedReminders((path) => router.push(path)), [router]);

  return null;
}
