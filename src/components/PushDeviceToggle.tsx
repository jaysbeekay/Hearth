"use client";

import { useEffect, useState, useTransition } from "react";
import { BellRing } from "lucide-react";
import {
  refreshPushSubscription,
  removePushSubscription,
  savePushSubscription,
  sendPushTest,
  type PushActionState,
} from "@/lib/actions/push";
import { FormMessage } from "@/components/FormMessage";
import { buttonClass } from "@/lib/ui";

type Status = "checking" | "unavailable" | "unsupported" | "no-worker" | "denied" | "off" | "on";

// applicationServerKey wants bytes; the VAPID public key is base64url.
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

function sameKey(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.byteLength) return false;
  const bytes = new Uint8Array(a);
  return bytes.every((value, i) => value === b.at(i));
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

function pushSupported(): boolean {
  return window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  return (await navigator.serviceWorker.getRegistration()) ?? null;
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
 * account anywhere else. The service worker shows them (src/sw.ts).
 */
export function PushDeviceToggle({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const [status, setStatus] = useState<Status>("checking");
  const [state, setState] = useState<PushActionState>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    async function check(): Promise<Status> {
      if (!vapidPublicKey) return "unavailable";
      if (!pushSupported()) return "unsupported";
      if (Notification.permission === "denied") return "denied";
      const reg = await registration();
      if (!reg) return "no-worker";
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return "off";
      // Keep this browser's own row current, but never re-add or take over a
      // row: a subscription the server has no row for, for this member (removed
      // from another device, or left by someone who signed in here before), is
      // dropped from the browser too.
      const { registered } = await refreshPushSubscription({ ...sub.toJSON(), deviceLabel: deviceLabel() });
      if (!registered) {
        await sub.unsubscribe();
        return "off";
      }
      const key = keyBytes(vapidPublicKey);
      if (!sameKey(sub.options.applicationServerKey, key)) {
        // Made with keys the server no longer has: it can't receive anything.
        await sub.unsubscribe();
        const fresh = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        const result = await savePushSubscription({ ...fresh.toJSON(), deviceLabel: deviceLabel(), previousEndpoint: sub.endpoint });
        if (result?.error) {
          if (!cancelled) setState(result);
          return "off";
        }
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
        if (!(await registration())) {
          setStatus("no-worker");
          return;
        }
        // subscribe() needs an active worker, not one still installing.
        const reg = await navigator.serviceWorker.ready;
        // A subscription made with an older key can't be reused.
        const old = await reg.pushManager.getSubscription();
        await old?.unsubscribe();
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidPublicKey) });
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
        const sub = await (await registration())?.pushManager.getSubscription();
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
      <FormMessage attempt={state} error={state?.error} success={state?.success} />
    </div>
  );
}
