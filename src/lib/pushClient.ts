// #375 — browser-side Web Push helpers, shared by the Settings toggle and
// sign-out. Client-only: every function touches navigator or window.

// applicationServerKey wants bytes; the VAPID public key is base64url.
export function vapidKeyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** "Chrome on Android": enough to tell a member's devices apart in Settings. */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

export function pushSupported(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window;
}

export async function pushRegistration(): Promise<ServiceWorkerRegistration | null> {
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

/**
 * This browser's push subscription, or null. Gives up after `ms` so a
 * stuck service worker can't hold up sign-out.
 */
export async function currentPushSubscription(ms = 2_000): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const lookup = (async () => (await pushRegistration())?.pushManager.getSubscription() ?? null)();
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));
  return Promise.race([lookup.catch(() => null), timeout]);
}
