"use client";

import { useEffect, useState, useTransition } from "react";
import { BellRing } from "lucide-react";
import { removePushSubscription, savePushSubscription, sendPushTest, type PushActionState } from "@/lib/actions/push";
import { FormMessage } from "@/components/FormMessage";
import { buttonClass } from "@/lib/ui";

type Status = "checking" | "unsupported" | "no-worker" | "denied" | "off" | "on";

// applicationServerKey wants bytes; the VAPID public key is base64url.
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

/**
 * #375 — "Notify this device": Web Push Reminders on this browser, with no
 * account anywhere else. The service worker shows them (src/sw.ts).
 */
export function PushDeviceToggle({ vapidPublicKey }: { vapidPublicKey: string }) {
  const [status, setStatus] = useState<Status>("checking");
  const [state, setState] = useState<PushActionState>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        return "unsupported" as const;
      }
      if (Notification.permission === "denied") return "denied" as const;
      const reg = await registration();
      if (!reg) return "no-worker" as const;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return "off" as const;
      // Re-save on each visit: picks up a rotated subscription, or one this
      // device had before the server forgot it.
      await savePushSubscription({ ...sub.toJSON(), deviceLabel: deviceLabel() });
      return "on" as const;
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
      const reg = await registration();
      if (!reg) return setStatus("no-worker");
      try {
        // A subscription made with an older key can't be reused.
        await (await reg.pushManager.getSubscription())?.unsubscribe();
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidPublicKey) });
        const result = await savePushSubscription({ ...sub.toJSON(), deviceLabel: deviceLabel() });
        setState(result);
        if (!result?.error) setStatus("on");
      } catch (error) {
        setState({ error: error instanceof Error ? error.message : "This browser couldn't turn on push." });
      }
    });
  }

  function disable() {
    startTransition(async () => {
      const sub = await (await registration())?.pushManager.getSubscription();
      if (sub) {
        setState(await removePushSubscription({ endpoint: sub.endpoint }));
        await sub.unsubscribe();
      }
      setStatus("off");
    });
  }

  function test() {
    startTransition(async () => setState(await sendPushTest()));
  }

  const note: Partial<Record<Status, string>> = {
    unsupported: "This browser can't show push notifications here. On iPhone, add Hearth to the Home Screen first.",
    "no-worker": "Push needs the app's service worker, which isn't running on this page (it's off in development).",
    denied: "Notifications are blocked for this site. Allow them in the browser's site settings, then reload.",
  };

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
      <FormMessage attempt={state} error={state?.error} success={state?.success} />
    </div>
  );
}
