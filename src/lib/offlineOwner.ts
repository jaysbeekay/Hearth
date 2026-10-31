// #424 — whose offline data is this? Everything the app keeps on the device
// for offline use (the service worker's page/data caches, the IndexedDB
// write queue, offline Documents) belongs to the user who was signed in when
// it was stored. On a shared device the next person to sign in must never
// see or replay it. This module is the pure part of that: the owner of the
// current tab, the rules for which entries a user may see, and the cache
// names and keys the service worker scopes by user. It has no browser or idb
// imports, so the service worker and the unit tests can use it too.

export interface OfflineOwner {
  userId: string;
  canWrite: boolean;
}

let currentOwner: OfflineOwner | null = null;

/** Set from the (app) layout as it renders, before any page reads the queue. */
export function setOfflineOwner(owner: OfflineOwner): void {
  if (currentOwner?.userId === owner.userId && currentOwner.canWrite === owner.canWrite) return;
  currentOwner = { ...owner };
}

export function getOfflineOwner(): OfflineOwner | null {
  return currentOwner;
}

export function clearOfflineOwner(): void {
  currentOwner = null;
}

/** True when an entry stored for `ownerId` belongs to `owner`. Unowned entries never do. */
export function isOwnedBy(ownerId: string | undefined, owner: OfflineOwner | null): boolean {
  return !!owner && !!ownerId && ownerId === owner.userId;
}

/** Only a signed-in member who can write may queue a change for later. */
export function canQueueOffline(owner: OfflineOwner | null): boolean {
  return !!owner && owner.canWrite;
}

/**
 * Queued writes stored before #424 carry no owner. The first member who can
 * write to load the app adopts them, so those unsynced changes go to whoever
 * is using the device (almost always the same person, mid-session) rather
 * than being lost. A read-only member never adopts them; they're purged
 * instead. Only queued writes are ever adopted: unowned offline Documents
 * and cached lists are just copies of server data, so they're purged.
 */
export function unownedToAdopt<T extends { ownerId?: string }>(entries: T[], owner: OfflineOwner): T[] {
  return canQueueOffline(owner) ? entries.filter((entry) => !entry.ownerId) : [];
}

/**
 * The signed-in user's writes left marked "syncing" by a sync that never
 * finished (the tab closed or crashed mid-request). Put back to "pending" so
 * they're counted and resent; /api/sync's per-operation receipts make a
 * resend of one that did reach the server a no-op.
 */
export function stuckSyncing<T extends { ownerId?: string; status: string }>(ops: T[], userId: string): T[] {
  return ops.filter((op) => op.ownerId === userId && op.status === "syncing");
}

// --- Service worker side -------------------------------------------------

/** The cache holding the signed-in user's marker, read by the service worker. */
export const SESSION_CACHE = "hearth-session";
export const SESSION_MARKER_PATH = "/__hearth/offline-session";

/** Written by the app while signed in; removed on sign-out. */
export interface SessionMarker {
  userId: string;
  /** Epoch ms the session expires at; the worker stops serving after it. */
  expires: number;
}

// Runtime caches that hold signed-in content: pages and their RSC payloads,
// GET /api responses (including Document bytes), and anything else
// same-origin. Static build assets (JS, CSS, fonts, icons) and the precache
// carry nothing user-specific and are kept, so the app still loads fast.
const USER_DATA_CACHES = new Set([
  "pages",
  "pages-rsc",
  "pages-rsc-prefetch",
  "apis",
  "others",
  "next-data",
  "next-image",
  "static-data-assets",
  "cross-origin",
  SESSION_CACHE,
]);

export function isUserDataCache(name: string): boolean {
  return USER_DATA_CACHES.has(name);
}

export function isValidSessionMarker(value: unknown, now: number): value is SessionMarker {
  if (!value || typeof value !== "object") return false;
  const { userId, expires } = value as Partial<SessionMarker>;
  return typeof userId === "string" && userId.length > 0 && typeof expires === "number" && expires > now;
}

const OWNER_PARAM = "__hearth_owner";

/**
 * The key a runtime cache stores a response under: the URL plus its owner's
 * id, so a different user's lookup can never match it, even if a purge was
 * missed.
 */
export function ownerScopedCacheKey(url: string, userId: string): string {
  const scoped = new URL(url);
  scoped.searchParams.set(OWNER_PARAM, userId);
  return scoped.toString();
}

export class OfflineStorageTimeoutError extends Error {}

/**
 * Rejects if `work` hasn't settled within `ms`. IndexedDB can stall (another
 * tab holding an old version open), and sign-out mustn't hang on it.
 */
export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new OfflineStorageTimeoutError("Timed out reading this device's offline data."));
    }, ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
