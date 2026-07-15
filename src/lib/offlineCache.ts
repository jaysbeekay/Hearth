import { openDB } from "idb";

const DB_NAME = "hearth-cache";
const STORE_NAME = "pages";
export const QUEUE_STORE = "offline-queue";
export const FILES_STORE = "pending-files";
export const DOCUMENTS_STORE = "offline-documents";

export function getDb() {
  return openDB(DB_NAME, 4, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore(STORE_NAME);
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
    },
  });
}

export async function cachePageData(key: string, data: unknown): Promise<void> {
  if (typeof window === "undefined") return;
  const db = await getDb();
  await db.put(STORE_NAME, data, key);
}

export async function getCachedPageData<T>(key: string): Promise<T | null> {
  if (typeof window === "undefined") return null;
  const db = await getDb();
  const value = await db.get(STORE_NAME, key);
  return (value as T) ?? null;
}
