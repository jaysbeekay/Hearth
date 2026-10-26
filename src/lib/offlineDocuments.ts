import { getDb, DOCUMENTS_STORE } from "@/lib/offlineCache";
import { documentFileHref, LEGACY_DOCUMENT_FILE_PREFIXES } from "@/lib/documents/kinds";
import { getOfflineOwner, isOwnedBy } from "@/lib/offlineOwner";

export interface OfflineDocument {
  url: string; // the download URL itself, e.g. "/api/documents/abc123" — the store key
  // #424 — the user who downloaded it; no one else's session lists or opens it.
  ownerId?: string;
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
  const owner = getOfflineOwner();
  if (!owner) throw new Error("Sign in to save documents offline.");
  const res = await fetch(url);
  if (!res.ok) throw new Error("Download failed");
  const blob = await res.blob();
  const db = await getDb();
  await db.put(DOCUMENTS_STORE, {
    url,
    ownerId: owner.userId,
    filename: meta.filename,
    mimeType: meta.mimeType,
    size: meta.size,
    cachedAt: Date.now(),
    blob,
  } satisfies OfflineDocument);
}

// #396 — every kind's file is now at /api/documents/<id>; the per-module
// URLs before it redirect there. A copy downloaded under either spelling is
// the same file, so a lookup tries the other spellings before giving up.
function equivalentUrls(url: string): string[] {
  const prefix = [documentFileHref(""), ...LEGACY_DOCUMENT_FILE_PREFIXES].find((p) => url.startsWith(p));
  if (!prefix) return [];
  const id = url.slice(prefix.length);
  if (!id || id.includes("/")) return [];
  return [documentFileHref(id), ...LEGACY_DOCUMENT_FILE_PREFIXES.map((p) => `${p}${id}`)].filter((u) => u !== url);
}

export async function getOfflineDocument(url: string): Promise<OfflineDocument | null> {
  if (typeof window === "undefined") return null;
  const owner = getOfflineOwner();
  if (!owner) return null;
  const db = await getDb();
  for (const candidate of [url, ...equivalentUrls(url)]) {
    const doc = (await db.get(DOCUMENTS_STORE, candidate)) as OfflineDocument | undefined;
    if (doc && isOwnedBy(doc.ownerId, owner)) return doc;
  }
  return null;
}

export async function removeOfflineDocument(url: string): Promise<void> {
  if (typeof window === "undefined") return;
  const db = await getDb();
  const doc = (await db.get(DOCUMENTS_STORE, url)) as OfflineDocument | undefined;
  if (!doc || !isOwnedBy(doc.ownerId, getOfflineOwner())) return;
  await db.delete(DOCUMENTS_STORE, url);
}

export async function listOfflineDocuments(): Promise<OfflineDocument[]> {
  if (typeof window === "undefined") return [];
  const owner = getOfflineOwner();
  if (!owner) return [];
  const db = await getDb();
  const all = (await db.getAll(DOCUMENTS_STORE)) as OfflineDocument[];
  return all.filter((doc) => isOwnedBy(doc.ownerId, owner));
}

export async function getOfflineDocumentsSize(): Promise<{ count: number; bytes: number }> {
  const docs = await listOfflineDocuments();
  return { count: docs.length, bytes: docs.reduce((sum, d) => sum + d.size, 0) };
}
