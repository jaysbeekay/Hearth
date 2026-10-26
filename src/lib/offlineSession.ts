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
  partitionByOwner,
  SESSION_CACHE,
  SESSION_MARKER_PATH,
  type SessionMarker,
} from "@/lib/offlineOwner";
import type { PendingFile, QueuedOperation } from "@/lib/offlineQueue";
import type { OfflineDocument } from "@/lib/offlineDocuments";

// #424 — the device-side half of "one user's offline data never reaches
// another": claiming it for whoever is signed in, and wiping it on sign-out.

const OWNER_KEY = "owner";

function hasCacheStorage(): boolean {
  return typeof window !== "undefined" && "caches" in window;
}

/** Deletes the service worker's caches that hold signed-in content (not the precache or static assets). */
export async function clearRuntimeCaches(): Promise<void> {
  if (!hasCacheStorage()) return;
  const names = await caches.keys();
  await Promise.all(names.filter(isUserDataCache).map((name) => caches.delete(name)));
}

async function writeSessionMarker(marker: SessionMarker): Promise<void> {
  if (!hasCacheStorage()) return;
  const cache = await caches.open(SESSION_CACHE);
  await cache.put(
    SESSION_MARKER_PATH,
    new Response(JSON.stringify(marker), { headers: { "Content-Type": "application/json" } }),
  );
}

/**
 * Claims this device's offline data for `userId`: anything queued, downloaded
 * or cached by another user is deleted, and the service worker is told who's
 * signed in until `expires`. Run on every load of the signed-in app.
 */
export async function claimOfflineData(userId: string, expires: number): Promise<void> {
  if (typeof window === "undefined") return;
  const db = await getDb();
  const previousOwner = (await db.get(META_STORE, OWNER_KEY)) as string | undefined;
  // Entries from before #424 have no owner. Hand them to the first user to
  // claim the device after the upgrade; after that, unowned means purge.
  const adoptUnowned = previousOwner === undefined;

  const tx = db.transaction([QUEUE_STORE, FILES_STORE, DOCUMENTS_STORE, PAGES_STORE, META_STORE], "readwrite");
  const queue = tx.objectStore(QUEUE_STORE);
  const files = tx.objectStore(FILES_STORE);
  const documents = tx.objectStore(DOCUMENTS_STORE);

  const ops = partitionByOwner((await queue.getAll()) as QueuedOperation[], userId, adoptUnowned);
  const purgedOpIds = new Set(ops.purge.map((op) => op.id));
  const docs = partitionByOwner((await documents.getAll()) as OfflineDocument[], userId, adoptUnowned);
  const staged = (await files.getAll()) as PendingFile[];

  await Promise.all([
    ...ops.purge.map((op) => queue.delete(op.id)),
    ...ops.adopt.map((op) => queue.put({ ...op, ownerId: userId })),
    ...staged.filter((f) => purgedOpIds.has(f.queueOpId)).map((f) => files.delete(f.id)),
    ...docs.purge.map((doc) => documents.delete(doc.url)),
    ...docs.adopt.map((doc) => documents.put({ ...doc, ownerId: userId })),
  ]);
  // Cached list data is only a read cache; a change of user drops it all.
  if (previousOwner !== userId) await tx.objectStore(PAGES_STORE).clear();
  await tx.objectStore(META_STORE).put(userId, OWNER_KEY);
  await tx.done;

  if (previousOwner !== undefined && previousOwner !== userId) await clearRuntimeCaches();
  await writeSessionMarker({ userId, expires });
}

/**
 * Sign-out: deletes the runtime caches, the write queue and its staged
 * files, offline Documents and cached list data. Unsynced changes are lost,
 * so callers confirm with the user first (SignOutButton).
 */
export async function clearOfflineData(): Promise<void> {
  if (typeof window === "undefined") return;
  clearOfflineOwner();
  await clearRuntimeCaches();
  const db = await getDb();
  const tx = db.transaction([QUEUE_STORE, FILES_STORE, DOCUMENTS_STORE, PAGES_STORE], "readwrite");
  await Promise.all([
    tx.objectStore(QUEUE_STORE).clear(),
    tx.objectStore(FILES_STORE).clear(),
    tx.objectStore(DOCUMENTS_STORE).clear(),
    tx.objectStore(PAGES_STORE).clear(),
    tx.done,
  ]);
}
