import { openDB } from "idb";

const DB_NAME = "hearth-cache";
const STORE_NAME = "pages";

function getDb() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
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
