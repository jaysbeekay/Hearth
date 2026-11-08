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

/** What `/api/auth/session` says: nobody signed in, who is, or null when it couldn't be asked. */
export type SessionCheck = { signedIn: false } | { signedIn: true; userId: string | null; expires: number } | null;

/**
 * Asks `/api/auth/session` who is signed in. Null when the server couldn't
 * be asked, including when it hasn't answered within `ms` (a stalled
 * connection would otherwise hold up every later try).
 */
export async function readSession(fetchImpl: typeof fetch = fetch, ms = 10_000): Promise<SessionCheck> {
  try {
    const response = await fetchImpl("/api/auth/session", {
      cache: "no-store",
      credentials: "same-origin",
      signal: AbortSignal.timeout(ms),
    });
    if (!response.ok) return null;
    const session = (await response.json()) as { user?: { id?: unknown }; expires?: unknown } | null;
    if (!session?.user) return { signedIn: false };
    const id = session.user.id;
    const expires = typeof session.expires === "string" ? Date.parse(session.expires) : NaN;
    return { signedIn: true, userId: typeof id === "string" && id !== "" ? id : null, expires };
  } catch {
    return null;
  }
}

/** The part of a PushSubscription the cleanup uses. */
export interface DroppableSubscription {
  endpoint: string;
  unsubscribe(): Promise<boolean>;
}

/**
 * This browser's subscription, or null when it has none. Unlike
 * currentPushSubscription, throws when the browser didn't answer within
 * `ms`, so a caller can tell "none" from "couldn't tell".
 */
export async function lookupPushSubscription(ms = 2_000): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  return withTimeout((async () => (await pushRegistration())?.pushManager.getSubscription() ?? null)(), ms);
}

/** Unsubscribes, giving up after `ms`. Whether it's gone; never throws. */
async function dropSubscription(sub: DroppableSubscription, ms = 2_000): Promise<boolean> {
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
 * Whether it's settled: false when the browser couldn't be asked or refused.
 */
export async function unsubscribeIfStill(
  endpoint: string,
  lookup: () => Promise<DroppableSubscription | null> = lookupPushSubscription,
): Promise<boolean> {
  let current: DroppableSubscription | null;
  try {
    current = await lookup();
  } catch {
    return false;
  }
  if (current?.endpoint !== endpoint) return true;
  return dropSubscription(current);
}

export interface SignedOutPushDeps {
  readSession: () => Promise<SessionCheck>;
  lookup: () => Promise<DroppableSubscription | null>;
  /** Writes the service worker's marker for a member who is signed in after all. */
  markSignedIn: (userId: string, expires: number) => Promise<void>;
  /**
   * Tells the service worker nobody is signed in (pushGate.ts). False when
   * a member's live marker was there and `force` wasn't set; rejects when
   * it couldn't be done.
   */
  markSignedOut: (force?: boolean) => Promise<boolean>;
}

/**
 * The sign-in page's push cleanup. Whether it's settled: false when the
 * server or the browser couldn't be asked, or the unsubscribe failed, so
 * it's tried again.
 * - Signed in after all (Back to a cached sign-in page): the caches this
 *   page cleared took the service worker's marker with them, so it's
 *   written again, and push stays.
 * - Signed out: the worker is told, and this browser's subscription is
 *   dropped. It's looked up only now, after the round-trip, so one turned on
 *   in another tab meanwhile is the one checked.
 */
export async function settleSignedOutPush(deps: SignedOutPushDeps): Promise<boolean> {
  const session = await deps.readSession();
  if (session === null) return false;
  if (session.signedIn) {
    if (session.userId && Number.isFinite(session.expires)) {
      await deps.markSignedIn(session.userId, session.expires).catch(() => {});
    }
    return true;
  }
  let marked: boolean;
  try {
    marked = await deps.markSignedOut();
  } catch {
    return false;
  }
  if (!marked) {
    // A member's marker is there: someone signed in since, in another tab,
    // or it's the last member's, left by a clear that timed out. Ask again.
    const again = await deps.readSession();
    if (again === null) return false;
    if (again.signedIn) {
      if (again.userId && Number.isFinite(again.expires)) {
        await deps.markSignedIn(again.userId, again.expires).catch(() => {});
      }
      return true;
    }
    try {
      await deps.markSignedOut(true);
    } catch {
      return false;
    }
  }
  let sub: DroppableSubscription | null;
  try {
    sub = await deps.lookup();
  } catch {
    return false;
  }
  return sub ? dropSubscription(sub) : true;
}

/**
 * #375 — when a signed-in tab comes back into view: writes the service
 * worker's marker with the session's current expiry, which rolls on with
 * every request while the layout (and its `expires`) stays put. Only for the
 * member this tab belongs to, and only with an expiry the server gave.
 */
export async function refreshSessionMarker(
  userId: string,
  deps: { readSession: () => Promise<SessionCheck>; mark: (userId: string, expires: number) => Promise<void> },
): Promise<boolean> {
  const session = await deps.readSession();
  if (!session?.signedIn || session.userId !== userId || !Number.isFinite(session.expires)) return false;
  await deps.mark(userId, session.expires);
  return true;
}

/** Whether this device's push row is the signed-in member's own. */
export type PushOwnership = "own" | "not-own" | "unknown";

/**
 * #375 — asked before signing out, so a sign-out that then fails can put
 * back only a row the member had. "unknown" when the server didn't answer
 * within `ms`.
 */
export async function pushOwnership(check: () => Promise<{ registered: boolean }>, ms = 3_000): Promise<PushOwnership> {
  try {
    return (await withTimeout(check(), ms)).registered ? "own" : "not-own";
  } catch {
    return "unknown";
  }
}

/**
 * After a sign-out that failed: puts back the member's own push row, in
 * case the server deleted it before the answer was lost. Never creates one
 * for a member who didn't have it. Whether push is known to be as it was:
 * false when the row couldn't be put back, or ownership wasn't known, so
 * the member is told to check Settings.
 */
export async function restorePushAfterFailedSignOut(
  ownership: PushOwnership,
  save: () => Promise<{ error?: string; success?: string } | null>,
  ms = 3_000,
): Promise<boolean> {
  if (ownership === "not-own") return true;
  if (ownership === "unknown") return false;
  try {
    return !(await withTimeout(save(), ms))?.error;
  } catch {
    return false;
  }
}
