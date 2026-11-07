import { withTimeout } from "@/lib/offlineOwner";

// #375 — browser-side Web Push helpers, shared by the Settings toggle,
// sign-out and the sign-in page. Client-only: every function touches
// navigator or window.

// applicationServerKey wants bytes; the VAPID public key is base64url.
export function vapidKeyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/** Whether a subscription was made with this application server key. */
export function sameVapidKey(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.byteLength) return false;
  return new Uint8Array(a).every((value, i) => value === b.at(i));
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
 * The SHA-256 of an endpoint, hex. Settings gets these instead of the
 * member's endpoint URLs, which are capability URLs, and matches this
 * browser's against them.
 */
export async function endpointHash(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * This browser's push subscription, or null. Gives up after `ms` so a
 * stuck service worker can't hold up sign-out.
 */
export async function currentPushSubscription(ms = 2_000): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const lookup = async () => (await pushRegistration())?.pushManager.getSubscription() ?? null;
  try {
    return await withTimeout(lookup(), ms);
  } catch {
    return null;
  }
}

/**
 * Whether `/api/auth/session` says nobody is signed in: true when it does,
 * false when someone is, null when the server couldn't be asked, including
 * when it hasn't answered within `ms` (a stalled connection would otherwise
 * hold up every later try).
 */
export async function sessionEnded(fetchImpl: typeof fetch = fetch, ms = 10_000): Promise<boolean | null> {
  try {
    const response = await fetchImpl("/api/auth/session", {
      cache: "no-store",
      credentials: "same-origin",
      signal: AbortSignal.timeout(ms),
    });
    if (!response.ok) return null;
    const session = (await response.json()) as { user?: unknown } | null;
    return !session?.user;
  } catch {
    return null;
  }
}

/**
 * Drops this browser's subscription, giving up after `ms`. Never throws.
 * Whether it's gone: false when the browser refused or didn't answer.
 */
export async function unsubscribeQuietly(sub: PushSubscription | null, ms = 2_000): Promise<boolean> {
  if (!sub) return true;
  try {
    return await withTimeout(sub.unsubscribe(), ms);
  } catch {
    // The server row goes on the next send (410) or 30 days of failures.
    return false;
  }
}

/**
 * Drops this browser's subscription only if it's still the one with
 * `endpoint`. Unsubscribing applies to the whole service worker
 * registration, so after a wait (a server round-trip) an older
 * PushSubscription object would also drop one the member has just turned on.
 */
export async function unsubscribeIfStill(endpoint: string): Promise<boolean> {
  const current = await currentPushSubscription();
  if (current?.endpoint !== endpoint) return true;
  return unsubscribeQuietly(current);
}
