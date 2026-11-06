"use client";

import { useEffect, useState, useTransition } from "react";
import { BellRing } from "lucide-react";
import {
  refreshPushSubscription,
  removePushDevice,
  removePushSubscription,
  savePushSubscription,
  sendPushTest,
  type PushActionState,
} from "@/lib/actions/push";
import { FormMessage } from "@/components/FormMessage";
import { Timestamp } from "@/components/Timestamp";
import { pushDeviceFailing } from "@/lib/notifications/pushStatus";
import {
  deviceLabel,
  endpointHash,
  pushRegistration,
  pushSupported,
  sameVapidKey,
  vapidKeyBytes,
} from "@/lib/pushClient";
import { buttonClass } from "@/lib/ui";

type Status = "checking" | "unavailable" | "unsupported" | "no-worker" | "denied" | "off" | "on";

/**
 * One of the member's own subscribed devices, as Settings lists them. The
 * endpoint itself stays on the server: its hash is enough to spot this
 * browser's row.
 */
export interface PushDevice {
  id: string;
  endpointHash: string;
  deviceLabel: string | null;
  createdAt: Date;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastError: string | null;
}

function noteFor(status: Status): string | null {
  switch (status) {
    case "unavailable":
      return "Push isn't available on this server right now. An admin can check the server log.";
    case "unsupported":
      return "This browser can't show push notifications here. On iPhone, add Hearth to the Home Screen first.";
    case "no-worker":
      return "Push needs the app's service worker, which isn't running on this page (it's off in development).";
    case "denied":
      return "Notifications are blocked for this site. Allow them in the browser's site settings, then reload.";
    default:
      return null;
  }
}

function errorMessage(error: unknown, fallback: string): PushActionState {
  return { error: error instanceof Error ? error.message : fallback };
}

/**
 * #375 — "Notify this device": Web Push Reminders on this browser, with no
 * account anywhere else (the service worker shows them, src/sw.ts), plus the
 * member's other devices, each removable, e.g. a lost phone.
 */
export function PushDeviceToggle({ vapidPublicKey, devices }: { vapidPublicKey: string | null; devices: PushDevice[] }) {
  const [status, setStatus] = useState<Status>("checking");
  // The hash of this browser's endpoint, once known, to leave it out of
  // "Your other devices".
  const [thisDevice, setThisDevice] = useState<string | null>(null);
  const [state, setState] = useState<PushActionState>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    function remember(hash: string) {
      if (!cancelled) setThisDevice(hash);
    }
    async function check(): Promise<Status> {
      if (!vapidPublicKey) return "unavailable";
      if (!pushSupported()) return "unsupported";
      if (Notification.permission === "denied") return "denied";
      const reg = await pushRegistration();
      if (!reg) return "no-worker";
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return "off";
      remember(await endpointHash(sub.endpoint));
      // Keep this browser's own row current, but never re-add or take over a
      // row: a subscription the server has no row for, for this member (removed
      // from another device, or left by someone who signed in here before), is
      // dropped from the browser too.
      const { registered } = await refreshPushSubscription({ ...sub.toJSON(), deviceLabel: deviceLabel() });
      if (!registered) {
        await sub.unsubscribe();
        return "off";
      }
      const key = vapidKeyBytes(vapidPublicKey);
      if (!sameVapidKey(sub.options.applicationServerKey, key)) {
        // Made with keys the server no longer has: it can't receive anything.
        await sub.unsubscribe();
        const fresh = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        const result = await savePushSubscription({ ...fresh.toJSON(), deviceLabel: deviceLabel(), previousEndpoint: sub.endpoint });
        if (result?.error) {
          if (!cancelled) setState(result);
          return "off";
        }
        remember(await endpointHash(fresh.endpoint));
      }
      return "on";
    }
    check()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {
        if (!cancelled) setStatus("off");
      });
    return () => {
      cancelled = true;
    };
  }, [vapidPublicKey]);

  function enable() {
    if (!vapidPublicKey) return;
    startTransition(async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setStatus(permission === "denied" ? "denied" : "off");
          return;
        }
        if (!(await pushRegistration())) {
          setStatus("no-worker");
          return;
        }
        // subscribe() needs an active worker, not one still installing.
        const reg = await navigator.serviceWorker.ready;
        // A subscription made with an older key can't be reused.
        const old = await reg.pushManager.getSubscription();
        await old?.unsubscribe();
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes(vapidPublicKey) });
        setThisDevice(await endpointHash(sub.endpoint));
        const result = await savePushSubscription({ ...sub.toJSON(), deviceLabel: deviceLabel(), previousEndpoint: old?.endpoint });
        setState(result);
        if (!result?.error) setStatus("on");
      } catch (error) {
        setState(errorMessage(error, "This browser couldn't turn on push."));
      }
    });
  }

  function disable() {
    startTransition(async () => {
      try {
        const sub = await (await pushRegistration())?.pushManager.getSubscription();
        if (sub) {
          setState(await removePushSubscription({ endpoint: sub.endpoint }));
          await sub.unsubscribe();
        }
        setStatus("off");
      } catch (error) {
        setState(errorMessage(error, "Couldn't turn push off."));
      }
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      try {
        setState(await removePushDevice({ id }));
      } catch (error) {
        setState(errorMessage(error, "Couldn't remove that device."));
      }
    });
  }

  function test() {
    startTransition(async () => {
      try {
        setState(await sendPushTest());
      } catch (error) {
        setState(errorMessage(error, "Couldn't send a test notification."));
      }
    });
  }

  const note = noteFor(status);
  // Until this browser's own subscription is known, it could be any row.
  const others = status === "checking" ? [] : devices.filter((d) => d.endpointHash !== thisDevice);

  return (
    <div className="space-y-2" data-testid="push-device">
      <p className="text-sm">
        {status === "on" ? "Push reminders are on for this device." : "Get reminders as notifications on this device."}
      </p>
      {(status === "on" || status === "off") && (
        <div className="flex flex-wrap gap-2">
          {status === "on" ? (
            <>
              <button type="button" className={buttonClass("secondary")} onClick={test} disabled={pending}>
                Send test
              </button>
              <button type="button" className={buttonClass("quiet")} onClick={disable} disabled={pending}>
                Turn off
              </button>
            </>
          ) : (
            <button type="button" className={buttonClass("primary")} onClick={enable} disabled={pending}>
              <BellRing size={16} aria-hidden />
              Notify this device
            </button>
          )}
        </div>
      )}
      {note && <p className="text-xs text-muted">{note}</p>}
      {others.length > 0 && (
        <div className="pt-1">
          <h3 className="text-xs text-muted">Your other devices</h3>
          <ul className="divide-y divide-border" data-testid="push-other-devices">
            {others.map((d) => (
              <li key={d.id} className="flex items-center gap-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{d.deviceLabel ?? "Unnamed device"}</p>
                  <p className={`text-xs ${pushDeviceFailing(d) ? "text-danger" : "text-muted"}`}>
                    {pushDeviceFailing(d) ? (
                      <>Last push failed{d.lastError ? `: ${d.lastError}` : ""}</>
                    ) : d.lastSuccessAt ? (
                      <>
                        Last reminder <Timestamp value={d.lastSuccessAt} />
                      </>
                    ) : (
                      <>
                        Added <Timestamp value={d.createdAt} />
                      </>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  className={buttonClass("quiet", { destructive: true })}
                  onClick={() => {
                    remove(d.id);
                  }}
                  disabled={pending}
                  aria-label={`Remove ${d.deviceLabel ?? "device"}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <FormMessage attempt={state} error={state?.error} success={state?.success} />
    </div>
  );
}
