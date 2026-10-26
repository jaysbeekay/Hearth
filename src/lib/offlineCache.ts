import { openDB } from "idb";
import { getOfflineOwner } from "@/lib/offlineOwner";

const DB_NAME = "hearth-cache";
export const PAGES_STORE = "pages";
export const QUEUE_STORE = "offline-queue";
export const FILES_STORE = "pending-files";
export const DOCUMENTS_STORE = "offline-documents";
export const META_STORE = "meta";

export function getDb() {
  return openDB(DB_NAME, 5, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore(PAGES_STORE);
      }
      if (oldVersion < 2) {
        const store = db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
        store.createIndex("by-timestamp", "timestamp");
      }
      if (oldVersion < 3) {
        // File bytes staged for a queued create/update op, keyed by their
        // own id — indexed by the owning QueuedOperation.id for lookup/cleanup.
        const store = db.createObjectStore(FILES_STORE, { keyPath: "id" });
        store.createIndex("by-op", "queueOpId");
      }
      if (oldVersion < 4) {
        // Documents explicitly downloaded for offline viewing, keyed by their
        // own download URL — already globally unique across the 9 separate
        // per-domain document tables, so no extra id scheme is needed.
        db.createObjectStore(DOCUMENTS_STORE, { keyPath: "url" });
      }
      if (oldVersion < 5) {
        // #424 — which user this device's offline data belongs to (see
        // offlineSession.ts).
        db.createObjectStore(META_STORE);
      }
    },
  });
}

// #424 — keyed by the signed-in user, so one user's cached lists are never
// read back for another, and nothing is cached when nobody is signed in.
function ownerKey(key: string): string | null {
  const owner = getOfflineOwner();
  return owner ? `${owner.userId}:${key}` : null;
}

export async function cachePageData(key: string, data: unknown): Promise<void> {
  if (typeof window === "undefined") return;
  const scoped = ownerKey(key);
  if (!scoped) return;
  const db = await getDb();
  await db.put(PAGES_STORE, data, scoped);
}

export async function getCachedPageData<T>(key: string): Promise<T | null> {
  if (typeof window === "undefined") return null;
  const scoped = ownerKey(key);
  if (!scoped) return null;
  const db = await getDb();
  const value = await db.get(PAGES_STORE, scoped);
  return (value as T) ?? null;
}
