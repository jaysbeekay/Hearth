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
  isValidSessionMarker,
  OfflineStorageTimeoutError,
  SESSION_CACHE,
  SESSION_MARKER_PATH,
  setOfflineOwner,
  unownedToAdopt,
  withTimeout,
  type OfflineOwner,
  type SessionMarker,
} from "@/lib/offlineOwner";
import type { PendingFile, QueuedOperation } from "@/lib/offlineQueue";
import { isSignedOutMarker, type SignedOutMarker } from "@/lib/pushGate";
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

async function readStoredMarker(): Promise<unknown> {
  if (!hasCacheStorage()) return null;
  const res = await (await caches.open(SESSION_CACHE)).match(SESSION_MARKER_PATH);
  return res ? res.json().catch(() => null) : null;
}

async function putMarker(value: SessionMarker | SignedOutMarker): Promise<void> {
  const cache = await caches.open(SESSION_CACHE);
  await cache.put(
    SESSION_MARKER_PATH,
    new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } }),
  );
}

/**
 * Runs a read-then-write of the marker with no other tab's in between, where
 * the browser has Web Locks; otherwise just runs it.
 */
async function withMarkerLock(work: () => Promise<void>): Promise<void> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks) return work();
  // Bounded both ways: waiting for the lock, and holding it, so a tab whose
  // cache call hangs releases it instead of holding up every other tab's
  // marker writes. Rejects on either timeout; callers treat that as not
  // done. The lock covers read-then-write only: the cache deletes in
  // clearRuntimeCaches don't take it, and at worst leave no marker, which
  // only holds a Reminder's content back.
  const held = () => withTimeout(work(), STEP_TIMEOUT_MS);
  if (typeof AbortSignal.timeout === "function") {
    await locks.request("hearth-session-marker", { signal: AbortSignal.timeout(STEP_TIMEOUT_MS) }, held);
  } else {
    await locks.request("hearth-session-marker", held);
  }
}

async function writeSessionMarker(marker: SessionMarker): Promise<void> {
  if (!hasCacheStorage()) return;
  await withMarkerLock(async () => {
    // A page rendered from an older cached payload mustn't wind the same
    // member's expiry back.
    const stored = await readStoredMarker();
    if (isValidSessionMarker(stored, Date.now()) && stored.userId === marker.userId && stored.expires > marker.expires) return;
    await putMarker(marker);
  });
}

/**
 * #375 — on the sign-in page, once the server has confirmed nobody is signed
 * in: tells the service worker this browser's push subscription was left
 * behind (pushGate.ts). Without `force`, a member's marker that hasn't
 * expired is left in place and this returns false: either someone signed
 * in since, in another tab, or it's the last member's, left by a clear that
 * timed out. The caller asks the server again to tell which, and passes
 * `force` for the second. Rejects when the marker lock timed out.
 */
export async function markSignedOut(force = false): Promise<boolean> {
  if (typeof window === "undefined" || !hasCacheStorage()) return true;
  let written = false;
  await withMarkerLock(async () => {
    if (!force && isValidSessionMarker(await readStoredMarker(), Date.now())) return;
    await putMarker({ signedOut: true });
    written = true;
  });
  return written;
}

/**
 * #375 — on every signed-in page load, before anything else: a member is
 * signed in, so a signed-out marker left by the sign-in page is wrong now.
 * Removed straight away rather than after the claim, so a slow claim can't
 * leave the service worker reading it as proof and dropping their push. No
 * marker at all only holds a Reminder's content back.
 */
export async function clearSignedOutMarker(): Promise<void> {
  if (typeof window === "undefined" || !hasCacheStorage()) return;
  await withMarkerLock(async () => {
    if (!isSignedOutMarker(await readStoredMarker())) return;
    await (await caches.open(SESSION_CACHE)).delete(SESSION_MARKER_PATH);
  });
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
// Set when markOfflineSession gave up waiting for a claim, so that claim
// writes the marker again once it's done.
let markerWroteBeforeClaim = false;
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

/** True between a sign-out clearing this tab's offline data and the page being replaced. */
export function isSigningOut(): boolean {
  return signingOut;
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
    done.then(
      () => {
        // markOfflineSession stops waiting for a slow claim, so the marker
        // may already be written, and then deleted by this claim's clear.
        if (!markerWroteBeforeClaim || claim?.done !== done || signingOut || lastMarker?.userId !== owner.userId) return;
        markerWroteBeforeClaim = false;
        markerWritten = null;
        void markOfflineSession(lastMarker.userId, lastMarker.expires).catch(() => {});
      },
      () => {
        if (claim?.done === done) claim = null;
      },
    );
  }
  return claim.done;
}

/**
 * Tells the service worker who is signed in, until when. `expires` is the
 * session's expiry as of the last render, the last time the tab came into
 * view, or the sign-in page's session check: a session revoked on the server
 * before then isn't reflected here until one of those next happens.
 */
export async function markOfflineSession(userId: string, expires: number): Promise<void> {
  if (typeof window === "undefined" || signingOut) return;
  lastMarker = { userId, expires };
  // Wait for a claim in progress, which may clear the marker's cache, but
  // not for ever: a stalled one mustn't keep the marker unwritten. When it
  // finishes, it writes the marker again (claimOfflineData).
  if (claim) {
    await withTimeout(claim.done, STEP_TIMEOUT_MS).catch((error: unknown) => {
      if (error instanceof OfflineStorageTimeoutError) markerWroteBeforeClaim = true;
    });
  }
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
  // The marker goes with the caches. The sign-in page clears only once it
  // knows nobody is signed in, or couldn't ask (#576); in that last case, if
  // this page was reached by going Back while still signed in, going
  // Forward must write it again.
  markerWritten = null;
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
