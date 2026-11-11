import type { Page } from "@playwright/test";

// #375 — a stand-in for Web Push. The dev server runs no service worker and
// headless Chromium can't reach a real push service, so the page gets a
// granted permission and a registration whose subscription points at an
// endpoint that never resolves (*.invalid passes assertPushEndpoint, which
// lets unresolvable hosts through). The subscription is kept in
// localStorage, so it survives a reload like a real one.
export async function stubPushManager(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Headless Chromium in CI reports notifications as denied even after
    // grantPermissions, so the permission is part of the stand-in too.
    Object.defineProperty(Notification, "permission", { get: () => "granted" });
    Notification.requestPermission = async () => "granted";
    const KEY = "e2e-push-stub";
    const b64url = (bytes: Uint8Array) =>
      btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    function makeSub(saved: { endpoint: string; p256dh: string; auth: string; key: number[] }) {
      return {
        endpoint: saved.endpoint,
        expirationTime: null,
        options: { userVisibleOnly: true, applicationServerKey: new Uint8Array(saved.key).buffer },
        toJSON: () => ({ endpoint: saved.endpoint, expirationTime: null, keys: { p256dh: saved.p256dh, auth: saved.auth } }),
        unsubscribe: async () => {
          localStorage.removeItem(KEY);
          return true;
        },
      };
    }
    const pushManager = {
      getSubscription: async () => {
        const raw = localStorage.getItem(KEY);
        return raw ? makeSub(JSON.parse(raw)) : null;
      },
      subscribe: async (options: { applicationServerKey: Uint8Array }) => {
        const p256dh = new Uint8Array(65);
        p256dh[0] = 4;
        crypto.getRandomValues(p256dh.subarray(1));
        const saved = {
          endpoint: `https://push.e2e-stub.invalid/${crypto.randomUUID()}`,
          p256dh: b64url(p256dh),
          auth: b64url(crypto.getRandomValues(new Uint8Array(16))),
          key: Array.from(new Uint8Array(options.applicationServerKey)),
        };
        localStorage.setItem(KEY, JSON.stringify(saved));
        return makeSub(saved);
      },
    };
    const registration = { pushManager };
    if (!("PushManager" in window)) Object.defineProperty(window, "PushManager", { value: function PushManager() {} });
    Object.defineProperty(navigator.serviceWorker, "getRegistration", { value: async () => registration });
    Object.defineProperty(navigator.serviceWorker, "ready", { get: () => Promise.resolve(registration) });
  });
}
