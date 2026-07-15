"use client";

import { useEffect, useState } from "react";
import { Trash2, FileDown } from "lucide-react";
import {
  listOfflineDocuments,
  removeOfflineDocument,
  type OfflineDocument,
} from "@/lib/offlineDocuments";
import { humanFileSize } from "@/lib/utils";
import { showToast } from "@/components/Toast";

export function OfflineDocumentsPanel() {
  const [docs, setDocs] = useState<OfflineDocument[] | null>(null);

  useEffect(() => {
    listOfflineDocuments()
      .then(setDocs)
      .catch(() => setDocs([]));
  }, []);

  async function handleRemove(url: string) {
    await removeOfflineDocument(url);
    setDocs((prev) => prev?.filter((d) => d.url !== url) ?? null);
  }

  async function handleRemoveAll() {
    if (!docs) return;
    await Promise.all(docs.map((d) => removeOfflineDocument(d.url)));
    setDocs([]);
    showToast("Removed all downloaded documents.");
  }

  if (docs === null) return null;

  const totalBytes = docs.reduce((sum, d) => sum + d.size, 0);

  return (
    <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-medium">Downloaded documents</h2>
        {docs.length > 0 && (
          <button
            type="button"
            onClick={handleRemoveAll}
            className="text-xs font-medium text-danger hover:underline"
          >
            Remove all
          </button>
        )}
      </div>
      {docs.length === 0 ? (
        <p className="text-sm text-foreground/60">
          No documents downloaded for offline use yet — tap the download icon next to any
          document to make it available without a connection.
        </p>
      ) : (
        <>
          <p className="mb-2 text-xs text-foreground/50">
            {docs.length} {docs.length === 1 ? "document" : "documents"} · {humanFileSize(totalBytes)}{" "}
            stored on this device
          </p>
          <ul className="divide-y divide-border">
            {docs.map((doc) => (
              <li key={doc.url} className="flex items-center justify-between gap-3 py-2">
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <FileDown size={16} className="shrink-0 text-foreground/50" />
                  <span className="min-w-0 truncate">{doc.filename}</span>
                  <span className="shrink-0 text-foreground/50">{humanFileSize(doc.size)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => handleRemove(doc.url)}
                  aria-label={`Remove ${doc.filename} from offline storage`}
                  className="rounded-md p-2 text-foreground/50 hover:text-danger"
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
