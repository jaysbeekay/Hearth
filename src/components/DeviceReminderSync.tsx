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
/** After a failed sync, how soon to try again; doubles each time, up to RESYNC_MS. */
const RETRY_MS = 60 * 1000;

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
    let retry: ReturnType<typeof setTimeout> | undefined;
    let retryMs = RETRY_MS;
    let stopped = false;
    function failed() {
      // What was scheduled stays (scheduleDeviceReminders); try again soon
      // rather than in an hour.
      last = 0;
      if (stopped || retry) return;
      retry = setTimeout(() => ((retry = undefined), sync()), retryMs);
      retryMs = Math.min(retryMs * 2, RESYNC_MS);
    }
    function sync() {
      if (stopped || Date.now() - last < RESYNC_MS) return;
      // Turned off or signed out here since: nothing to keep current.
      if (deviceRemindersUser() !== userId) return;
      last = Date.now();
      syncDeviceReminders(userId).then((result) => {
        if (result?.error) failed();
        else retryMs = RETRY_MS;
      }, failed);
    }
    function onVisible() {
      if (document.visibilityState === "visible") sync();
    }
    sync();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(retry);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId]);

  useEffect(() => openTappedReminders((path) => router.push(path)), [router]);

  return null;
}
