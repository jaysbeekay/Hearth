import { openDB } from "idb";

const DB_NAME = "hearth-cache";
const STORE_NAME = "pages";
export const QUEUE_STORE = "offline-queue";

export function getDb() {
  return openDB(DB_NAME, 2, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore(STORE_NAME);
      }
      if (oldVersion < 2) {
        const store = db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
        store.createIndex("by-timestamp", "timestamp");
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
