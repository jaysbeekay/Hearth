"use client";

import { useEffect, useState, useTransition } from "react";
import { BellRing } from "lucide-react";
import { getDeviceReminders } from "@/lib/actions/deviceReminders";
import { FormMessage } from "@/components/FormMessage";
import { PushDeviceToggle, type PushDevice } from "@/components/PushDeviceToggle";
import {
  allowDeviceNotifications,
  cancelDeviceReminders,
  DeviceRemindersSuperseded,
  deviceRemindersAvailable,
  deviceRemindersUser,
  scheduleDeviceReminders,
  startDeviceReminderSync,
  turnOffDeviceReminders,
} from "@/lib/nativeReminders";
import { buttonClass } from "@/lib/ui";

type Message = { error?: string; success?: string } | null;

function scheduledMessage(count: number): string {
  if (count === 0) return "Reminders are on for this phone. Nothing is due in the next four months yet.";
  return `Reminders are on for this phone: ${count} scheduled over the next four months.`;
}

/** Fetches the household's Reminders ahead and schedules them here. */
export async function syncDeviceReminders(userId: string): Promise<Message> {
  // Taken before the fetch: a sign-out or turn-off while it's out wins.
  const ticket = startDeviceReminderSync();
  const result = await getDeviceReminders();
  if ("error" in result) {
    // The server says nobody is signed in: Reminders naming household records
    // go now, as they do on the sign-in page. "On" is kept, so the same
    // member's next sign-in schedules them again. Any other error keeps them.
    if (result.signedOut) await cancelDeviceReminders();
    return { error: result.error };
  }
  return { success: scheduledMessage(await scheduleDeviceReminders(userId, result.reminders, ticket)) };
}

/**
 * #375 — "Notify this phone" in the phone app, where the WebView has no Web
 * Push: the household's Reminders for the next four months are scheduled on
 * the device, and again each time the app opens (DeviceReminderSync).
 */
function DeviceReminderToggle({ userId }: { userId: string }) {
  const [on, setOn] = useState(() => deviceRemindersUser() === userId);
  const [state, setState] = useState<Message>(null);
  const [pending, startTransition] = useTransition();

  function enable() {
    startTransition(async () => {
      try {
        if (!(await allowDeviceNotifications())) {
          setState({ error: "Notifications are off for Hearth. Turn them on in the phone's Settings, then try again." });
          return;
        }
        const result = await syncDeviceReminders(userId);
        setState(result);
        if (!result?.error) setOn(true);
      } catch (error) {
        if (error instanceof DeviceRemindersSuperseded && deviceRemindersUser() === userId) {
          // A newer sync (the app's own) got there first and scheduled them.
          setOn(true);
          setState({ success: "Reminders are on for this phone." });
          return;
        }
        setState({ error: error instanceof Error ? error.message : "This phone couldn't schedule reminders." });
      }
    });
  }

  function disable() {
    startTransition(async () => {
      try {
        await turnOffDeviceReminders();
        setOn(false);
        setState({ success: "Reminders are off for this phone." });
      } catch (error) {
        setState({ error: error instanceof Error ? error.message : "Couldn't turn reminders off." });
      }
    });
  }

  return (
    <div className="space-y-2" data-testid="device-reminders">
      <p className="text-sm">{on ? "Reminders are on for this phone." : "Get reminders as notifications on this phone."}</p>
      <div className="flex flex-wrap gap-2">
        {on ? (
          <>
            <button type="button" className={buttonClass("secondary")} onClick={enable} disabled={pending}>
              Update now
            </button>
            <button type="button" className={buttonClass("quiet")} onClick={disable} disabled={pending}>
              Turn off
            </button>
          </>
        ) : (
          <button type="button" className={buttonClass("primary")} onClick={enable} disabled={pending}>
            <BellRing size={16} aria-hidden />
            Notify this phone
          </button>
        )}
      </div>
      <p className="text-xs text-muted">
        The app schedules them on this phone each time you open it, so open Hearth now and then to pick up changes.
      </p>
      <FormMessage attempt={state} error={state?.error} success={state?.success} />
    </div>
  );
}

/**
 * "Notify this device": Web Push in a browser, local notifications in the
 * phone app. Which one is known only in the browser, so neither shows until
 * then.
 */
export function NotifyThisDevice({
  userId,
  vapidPublicKey,
  devices,
}: {
  userId: string;
  vapidPublicKey: string | null;
  devices: PushDevice[];
}) {
  const [native, setNative] = useState<boolean | null>(null);
  useEffect(() => {
    // Read after mount: the server render can't know it's the phone app.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNative(deviceRemindersAvailable());
  }, []);
  if (native === null) return null;
  return native ? <DeviceReminderToggle userId={userId} /> : <PushDeviceToggle vapidPublicKey={vapidPublicKey} devices={devices} />;
}
