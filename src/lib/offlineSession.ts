import { openDB } from "idb";
import {
  getDb,
  DOCUMENTS_STORE,
  FILES_STORE,
  META_STORE,
  PAGES_STORE,
  QUEUE_STORE,
} from "@/lib/offlineCache";
import {
  clearOfflineOwner,
  isUserDataCache,
  SESSION_CACHE,
  SESSION_MARKER_PATH,
  setOfflineOwner,
  unownedToAdopt,
  withTimeout,
  type OfflineOwner,
  type SessionMarker,
} from "@/lib/offlineOwner";
import type { PendingFile, QueuedOperation } from "@/lib/offlineQueue";
import type { OfflineDocument } from "@/lib/offlineDocuments";

// #424 — the device-side half of "one user's offline data never reaches
// another": claiming it for whoever is signed in (anyone else's is purged),
// and wiping it on sign-out.

const OWNER_KEY = "owner";
const STEP_TIMEOUT_MS = 5_000;

// serwist's ExpirationPlugin keeps an index of every URL it cached, with
// when, in its own database. Clearing a cache leaves that index behind, so
// it's cleared alongside (#424 review).
const EXPIRATION_DB = "serwist-expiration";
const EXPIRATION_STORE = "cache-entries";

function hasCacheStorage(): boolean {
  return typeof window !== "undefined" && "caches" in window;
}

async function clearExpirationIndex(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  // Same schema serwist creates, so opening it first from here leaves a
  // database the service worker can use as-is.
  const db = await openDB(EXPIRATION_DB, 1, {
    upgrade(upgrading) {
      const store = upgrading.createObjectStore(EXPIRATION_STORE, { keyPath: "id" });
      store.createIndex("cacheName", "cacheName", { unique: false });
      store.createIndex("timestamp", "timestamp", { unique: false });
    },
  });
  try {
    const tx = db.transaction(EXPIRATION_STORE, "readwrite");
    const entries = (await tx.store.getAll()) as { id: string; cacheName: string }[];
    await Promise.all(
      entries.filter((entry) => isUserDataCache(entry.cacheName)).map((entry) => tx.store.delete(entry.id)),
    );
    await tx.done;
  } finally {
    db.close();
  }
}

/**
 * Deletes the service worker's caches that hold signed-in content (not the
 * precache or static assets), and serwist's record of the URLs in them.
 */
export async function clearRuntimeCaches(): Promise<void> {
  if (hasCacheStorage()) {
    const names = (await caches.keys()).filter(isUserDataCache);
    await Promise.all(names.map((name) => caches.delete(name)));
  }
  await clearExpirationIndex();
}

async function writeSessionMarker(marker: SessionMarker): Promise<void> {
  if (!hasCacheStorage()) return;
  const cache = await caches.open(SESSION_CACHE);
  await cache.put(
    SESSION_MARKER_PATH,
    new Response(JSON.stringify(marker), { headers: { "Content-Type": "application/json" } }),
  );
}

// --- Claiming ------------------------------------------------------------

let claim: { key: string; done: Promise<void> } | null = null;
// Set by a sign-out until the page is replaced (or the sign-out fails), so a
// re-render of the signed-in layout in the meantime can't claim the device
// or write the session marker again.
let signingOut = false;
let lastOwner: OfflineOwner | null = null;
let lastMarker: SessionMarker | null = null;
let markerWritten: string | null = null;
let resolveFirstClaim: () => void = () => {};
const firstClaim = new Promise<void>((resolve) => {
  resolveFirstClaim = resolve;
});

/**
 * Resolves once this tab's first claim has run (or after `ms` if it can't),
 * so a count read straight after an upgrade includes the writes that claim
 * adopts instead of briefly reading 0.
 */
export function whenOfflineDataClaimed(ms = 2_000): Promise<void> {
  return withTimeout(firstClaim, ms).catch(() => {});
}

/**
 * Claims this device's offline data for `owner`: another user's queued
 * writes, offline Documents and cached lists are purged; writes from before
 * #424 (unowned) are adopted by a member who can write and purged otherwise;
 * the owner's writes left mid-sync are put back in the queue; staged files
 * with no queued write are dropped. A change of user also clears the
 * service worker's caches. Runs once per tab per user, however often the
 * layout re-renders.
 */
/** True between a sign-out clearing this tab's offline data and the page being replaced. */
export function isSigningOut(): boolean {
  return signingOut;
}

export function claimOfflineData(owner: OfflineOwner): Promise<void> {
  if (typeof window === "undefined" || signingOut) return Promise.resolve();
  lastOwner = { ...owner };
  const key = `${owner.userId}:${owner.canWrite}`;
  if (claim?.key !== key) {
    const done = claimDatabase(owner).finally(() => {
      resolveFirstClaim();
    });
    claim = { key, done };
    // The claim may clear the cache the marker lives in; write it again after.
    markerWritten = null;
    done.catch(() => {
      if (claim?.done === done) claim = null;
    });
  }
  return claim.done;
}

/**
 * Tells the service worker who is signed in, until when. `expires` is the
 * session's expiry as of the last render: a session revoked on the server
 * before then isn't reflected here until the next load.
 */
export async function markOfflineSession(userId: string, expires: number): Promise<void> {
  if (typeof window === "undefined" || signingOut) return;
  lastMarker = { userId, expires };
  // Wait for a claim in progress, which may clear the marker's cache.
  await claim?.done.catch(() => {});
  const key = `${userId}:${expires}`;
  if (signingOut || markerWritten === key) return;
  await writeSessionMarker({ userId, expires });
  markerWritten = key;
}

async function claimDatabase(owner: OfflineOwner): Promise<void> {
  const { userId } = owner;
  const db = await getDb();
  const tx = db.transaction([QUEUE_STORE, FILES_STORE, DOCUMENTS_STORE, PAGES_STORE, META_STORE], "readwrite");
  const queue = tx.objectStore(QUEUE_STORE);
  const files = tx.objectStore(FILES_STORE);
  const documents = tx.objectStore(DOCUMENTS_STORE);
  const meta = tx.objectStore(META_STORE);

  const previousOwner = (await meta.get(OWNER_KEY)) as string | undefined;
  const ops = (await queue.getAll()) as QueuedOperation[];
  const docs = (await documents.getAll()) as OfflineDocument[];
  const staged = (await files.getAll()) as PendingFile[];

  const adopt = new Set(unownedToAdopt(ops, owner).map((op) => op.id));
  const keptOps = new Set<string>();
  const writes: Promise<unknown>[] = [];
  for (const op of ops) {
    const own = op.ownerId === userId;
    if (!own && !adopt.has(op.id)) {
      writes.push(queue.delete(op.id));
      continue;
    }
    keptOps.add(op.id);
    // Left "syncing" by a sync that never finished: send it again. A resend
    // that did reach the server is a no-op there (#249 receipts).
    if (!own || op.status === "syncing") {
      writes.push(queue.put({ ...op, ownerId: userId, status: op.status === "syncing" ? "pending" : op.status }));
    }
  }
  // Files of purged writes, and any left behind by a write already gone.
  for (const f of staged) {
    if (!keptOps.has(f.queueOpId)) writes.push(files.delete(f.id));
  }
  for (const doc of docs) {
    if (doc.ownerId !== userId) writes.push(documents.delete(doc.url));
  }
  // Cached list data is only a read cache; a change of user drops it all.
  if (previousOwner !== userId) writes.push(tx.objectStore(PAGES_STORE).clear());
  writes.push(meta.put(userId, OWNER_KEY));
  await Promise.all(writes);
  await tx.done;

  // Includes the first claim after the upgrade: caches from before #424
  // aren't keyed by user.
  if (previousOwner !== userId) await clearRuntimeCaches();
}

// --- Signing out ---------------------------------------------------------

async function clearStores(stores: string[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(stores, "readwrite");
  await Promise.all(stores.map((name) => tx.objectStore(name).clear()));
  await tx.done;
}

/**
 * Sign-out: deletes the runtime caches and session marker, the write queue
 * and its staged files, offline Documents and cached list data. Unsynced
 * changes are lost, so callers confirm with the user first (SignOutButton).
 * Each step runs even if another fails or stalls.
 */
export async function clearOfflineData(): Promise<void> {
  if (typeof window === "undefined") return;
  signingOut = true;
  clearOfflineOwner();
  claim = null;
  markerWritten = null;
  await Promise.allSettled([
    withTimeout(clearRuntimeCaches(), STEP_TIMEOUT_MS),
    withTimeout(clearStores([QUEUE_STORE, FILES_STORE, DOCUMENTS_STORE, PAGES_STORE]), STEP_TIMEOUT_MS),
  ]);
}

/**
 * On the sign-in page, whichever way the last session ended (a password
 * change, an expired session): everything but the write queue. Queued
 * writes are keyed by user, so only the same user signing back in sees and
 * syncs them; anyone else's claim purges them.
 */
export async function clearSignedOutData(): Promise<void> {
  if (typeof window === "undefined") return;
  await Promise.allSettled([
    withTimeout(clearRuntimeCaches(), STEP_TIMEOUT_MS),
    withTimeout(clearStores([DOCUMENTS_STORE, PAGES_STORE]), STEP_TIMEOUT_MS),
  ]);
}

/**
 * Undoes the in-memory and service-worker half of a sign-out that then
 * failed to reach the server, so offline use keeps working for the user
 * who is, after all, still signed in.
 */
export async function restoreOfflineSession(): Promise<void> {
  signingOut = false;
  if (!lastOwner) return;
  setOfflineOwner(lastOwner);
  await claimOfflineData(lastOwner).catch(() => {});
  if (lastMarker) await markOfflineSession(lastMarker.userId, lastMarker.expires).catch(() => {});
}

// --- Other tabs ----------------------------------------------------------

const CHANNEL = "hearth-session";

export type SessionBroadcast = { type: "signed-out" } | { type: "signed-in"; userId: string };

/** Tells this browser's other tabs that the signed-in user changed. */
export function broadcastSession(message: SessionBroadcast): void {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(CHANNEL);
  channel.postMessage(message);
  channel.close();
}

/** Calls `onMessage` for every broadcast from another tab; returns an unsubscribe. */
export function onSessionBroadcast(onMessage: (message: SessionBroadcast) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (event: MessageEvent<SessionBroadcast>) => {
    onMessage(event.data);
  };
  return () => {
    channel.close();
  };
}
