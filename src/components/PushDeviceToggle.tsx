"use client";

import { useEffect, useState, useTransition } from "react";
import { BellRing } from "lucide-react";
import {
  removePushDevice,
  removePushSubscription,
  savePushSubscription,
  sendPushTest,
  type PushActionState,
} from "@/lib/actions/push";
import { FormMessage } from "@/components/FormMessage";
import { Timestamp } from "@/components/Timestamp";
import { deviceLabel, pushRegistration, pushSupported, vapidKeyBytes } from "@/lib/pushClient";
import { buttonClass } from "@/lib/ui";

type Status = "checking" | "unsupported" | "no-worker" | "denied" | "off" | "on";

/** One of the member's own subscribed devices, as Settings lists them. */
export interface PushDevice {
  id: string;
  endpoint: string;
  deviceLabel: string | null;
  createdAt: Date;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastError: string | null;
}

function failing(d: PushDevice): boolean {
  return d.lastFailureAt != null && (d.lastSuccessAt == null || d.lastFailureAt > d.lastSuccessAt);
}

/**
 * #375 — "Notify this device": Web Push Reminders on this browser, with no
 * account anywhere else (the service worker shows them, src/sw.ts), plus the
 * member's other devices, each removable, e.g. a lost phone.
 */
export function PushDeviceToggle({ vapidPublicKey, devices }: { vapidPublicKey: string; devices: PushDevice[] }) {
  const [status, setStatus] = useState<Status>("checking");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [state, setState] = useState<PushActionState>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async (): Promise<Status> => {
      if (!pushSupported()) return "unsupported";
      if (Notification.permission === "denied") return "denied";
      const reg = await pushRegistration();
      if (!reg) return "no-worker";
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return "off";
      // Re-save on each visit: picks up a rotated subscription, or one this
      // device had before the server forgot it.
      await savePushSubscription({ ...sub.toJSON(), deviceLabel: deviceLabel() });
      if (!cancelled) setEndpoint(sub.endpoint);
      return "on";
    })()
      .then((next) => !cancelled && setStatus(next))
      .catch(() => !cancelled && setStatus("off"));
    return () => {
      cancelled = true;
    };
  }, []);

  function enable() {
    startTransition(async () => {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await pushRegistration();
      if (!reg) return setStatus("no-worker");
      try {
        // A subscription made with an older key can't be reused.
        await (await reg.pushManager.getSubscription())?.unsubscribe();
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes(vapidPublicKey) });
        const result = await savePushSubscription({ ...sub.toJSON(), deviceLabel: deviceLabel() });
        setState(result);
        if (!result?.error) {
          setEndpoint(sub.endpoint);
          setStatus("on");
        }
      } catch (error) {
        setState({ error: error instanceof Error ? error.message : "This browser couldn't turn on push." });
      }
    });
  }

  function disable() {
    startTransition(async () => {
      const sub = await (await pushRegistration())?.pushManager.getSubscription();
      if (sub) {
        setState(await removePushSubscription({ endpoint: sub.endpoint }));
        await sub.unsubscribe();
      }
      setEndpoint(null);
      setStatus("off");
    });
  }

  function remove(id: string) {
    startTransition(async () => setState(await removePushDevice({ id })));
  }

  function test() {
    startTransition(async () => setState(await sendPushTest()));
  }

  const note: Partial<Record<Status, string>> = {
    unsupported: "This browser can't show push notifications here. On iPhone, add Hearth to the Home Screen first.",
    "no-worker": "Push needs the app's service worker, which isn't running on this page (it's off in development).",
    denied: "Notifications are blocked for this site. Allow them in the browser's site settings, then reload.",
  };
  // Until this browser's own subscription is known, it could be any row.
  const others = status === "checking" ? [] : devices.filter((d) => d.endpoint !== endpoint);

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
      {note[status] && <p className="text-xs text-muted">{note[status]}</p>}
      {others.length > 0 && (
        <div className="pt-1">
          <h3 className="text-xs text-muted">Your other devices</h3>
          <ul className="divide-y divide-border" data-testid="push-other-devices">
            {others.map((d) => (
              <li key={d.id} className="flex items-center gap-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{d.deviceLabel ?? "Unnamed device"}</p>
                  <p className={`text-xs ${failing(d) ? "text-danger" : "text-muted"}`}>
                    {failing(d) ? (
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
                  onClick={() => remove(d.id)}
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
