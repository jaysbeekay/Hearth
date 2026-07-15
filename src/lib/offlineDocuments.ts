import { getDb, DOCUMENTS_STORE } from "@/lib/offlineCache";

export interface OfflineDocument {
  url: string; // the download URL itself, e.g. "/api/documents/abc123" — the store key
  filename: string;
  mimeType: string;
  size: number;
  cachedAt: number;
  blob: Blob;
}

export async function downloadForOffline(
  url: string,
  meta: { filename: string; mimeType: string; size: number },
): Promise<void> {
  if (typeof window === "undefined") return;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Download failed");
  const blob = await res.blob();
  const db = await getDb();
  await db.put(DOCUMENTS_STORE, {
    url,
    filename: meta.filename,
    mimeType: meta.mimeType,
    size: meta.size,
    cachedAt: Date.now(),
    blob,
  } satisfies OfflineDocument);
}

export async function getOfflineDocument(url: string): Promise<OfflineDocument | null> {
  if (typeof window === "undefined") return null;
  const db = await getDb();
  const doc = (await db.get(DOCUMENTS_STORE, url)) as OfflineDocument | undefined;
  return doc ?? null;
}

export async function removeOfflineDocument(url: string): Promise<void> {
  if (typeof window === "undefined") return;
  const db = await getDb();
  await db.delete(DOCUMENTS_STORE, url);
}

export async function listOfflineDocuments(): Promise<OfflineDocument[]> {
  if (typeof window === "undefined") return [];
  const db = await getDb();
  return (await db.getAll(DOCUMENTS_STORE)) as OfflineDocument[];
}

export async function getOfflineDocumentsSize(): Promise<{ count: number; bytes: number }> {
  const docs = await listOfflineDocuments();
  return { count: docs.length, bytes: docs.reduce((sum, d) => sum + d.size, 0) };
}
