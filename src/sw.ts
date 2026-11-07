import { defaultCache } from "@serwist/next/worker";
import { Serwist } from "serwist";
import { SESSION_CACHE, SESSION_MARKER_PATH } from "@/lib/offlineOwner";
import { createSessionCachePlugin, scopeRuntimeCaching } from "@/lib/swSessionPlugin";
import { notificationTarget } from "@/lib/pushNotificationUrl";
import { pushForSignedInMember, SIGNED_OUT_NOTICE } from "@/lib/pushGate";

// The DOM lib has no service-worker event types, and pulling in the
// webworker lib clashes with it, so the few used here are spelled out.
interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}
interface PushEvent extends ExtendableEvent {
  data: { json(): unknown } | null;
}
interface NotificationEvent extends ExtendableEvent {
  notification: Notification;
}
interface WindowClient {
  url: string;
  focus(): Promise<WindowClient>;
}

declare const self: typeof globalThis & {
  __SW_MANIFEST: (string | { url: string; revision: string | null })[];
  registration: ServiceWorkerRegistration;
  clients: {
    matchAll(options: { type: "window"; includeUncontrolled: boolean }): Promise<WindowClient[]>;
    openWindow(url: string): Promise<WindowClient | null>;
  };
  addEventListener(type: "push", listener: (event: PushEvent) => void): void;
  addEventListener(type: "notificationclick", listener: (event: NotificationEvent) => void): void;
};

// #424 — the signed-in user's marker, written by OfflineSessionGuard and
// removed on sign-out. Read per request: it's one small cache lookup.
async function readSessionMarker(): Promise<unknown> {
  const cache = await caches.open(SESSION_CACHE);
  const res = await cache.match(SESSION_MARKER_PATH);
  return res ? res.json() : null;
}

const sessionPlugin = createSessionCachePlugin(readSessionMarker);

// Scope every cache that can hold signed-in content to the current session
// (see swSessionPlugin.ts); static asset caches are left as they are.
const runtimeCaching = scopeRuntimeCaching(defaultCache, sessionPlugin);

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
});

serwist.addEventListeners();

// #375 — Web Push Reminders. The payload is buildPushReminder()'s
// { title, body, url, tag } plus the userId it's for; url is a path on this
// origin. Shown only while that member is signed in here (pushGate.ts);
// otherwise this browser's subscription is dropped, and a notice without any
// of the Reminder's content is shown instead, since a push must show
// something.
self.addEventListener("push", (event) => {
  let payload: { title?: unknown; body?: unknown; url?: unknown; tag?: unknown; userId?: unknown } = {};
  try {
    payload = (event.data?.json() ?? {}) as typeof payload;
  } catch {
    // Not JSON: there's no member to check it against, so it's dropped below.
  }
  event.waitUntil(
    (async () => {
      const marker = await readSessionMarker().catch(() => null);
      if (!pushForSignedInMember(payload.userId, marker, Date.now())) {
        const sub = await self.registration.pushManager.getSubscription().catch(() => null);
        await sub?.unsubscribe().catch(() => false);
        await self.registration.showNotification(SIGNED_OUT_NOTICE.title, {
          body: SIGNED_OUT_NOTICE.body,
          tag: SIGNED_OUT_NOTICE.tag,
          icon: "/icon.svg",
          data: { url: "/login" },
        });
        return;
      }
      const title = typeof payload.title === "string" ? payload.title : "Hearth reminder";
      await self.registration.showNotification(title, {
        body: typeof payload.body === "string" ? payload.body : undefined,
        tag: typeof payload.tag === "string" ? payload.tag : undefined,
        icon: "/icon.svg",
        data: { url: typeof payload.url === "string" ? payload.url : "/dashboard" },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Only ever open a page of this app, whatever the payload said.
  const url = notificationTarget(event.notification.data?.url, self.location.origin);
  event.waitUntil(
    (async () => {
      // Focus a tab already showing the record; otherwise open a new one, so
      // a tab with unsaved edits isn't navigated away from.
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((w) => w.url === url);
      if (open) {
        await open.focus();
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
