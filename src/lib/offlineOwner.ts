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

export interface OwnerPartition<T> {
  /** Already the current user's. */
  keep: T[];
  /** Another user's, or unowned when there's nothing to adopt: delete these. */
  purge: T[];
  /** Unowned and stored before #424, to stamp with the current user's id. */
  adopt: T[];
}

/**
 * Splits stored entries by owner. Entries written before #424 carry no owner;
 * `adoptUnowned` is true only the first time a user claims this device's data
 * after the upgrade, so those unsynced writes go to whoever is signed in then
 * (almost always the same person, mid-session) rather than being lost.
 */
export function partitionByOwner<T extends { ownerId?: string }>(
  entries: T[],
  userId: string,
  adoptUnowned: boolean,
): OwnerPartition<T> {
  const result: OwnerPartition<T> = { keep: [], purge: [], adopt: [] };
  for (const entry of entries) {
    if (entry.ownerId === userId) result.keep.push(entry);
    else if (!entry.ownerId && adoptUnowned) result.adopt.push(entry);
    else result.purge.push(entry);
  }
  return result;
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
