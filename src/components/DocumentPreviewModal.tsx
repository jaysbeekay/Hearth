"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { getOfflineDocument } from "@/lib/offlineDocuments";
import { useOnlineStatus } from "@/lib/useOnlineStatus";

export interface PreviewableDoc {
  filename: string;
  mimeType: string;
  downloadHref: string;
}

export function isPreviewable(mimeType: string) {
  return mimeType.startsWith("image/") || mimeType === "application/pdf";
}

export function DocumentPreviewModal({
  doc,
  onClose,
}: {
  doc: PreviewableDoc;
  onClose: () => void;
}) {
  const online = useOnlineStatus();
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;

    async function load() {
      // Offline: only the explicitly-downloaded blob is available — there's
      // no network fallback to try.
      if (!online) {
        const cached = await getOfflineDocument(doc.downloadHref);
        if (cancelled) return;
        if (!cached) {
          setError(true);
          return;
        }
        url = URL.createObjectURL(cached.blob);
        setObjectUrl(url);
        return;
      }

      try {
        const res = await fetch(doc.downloadHref);
        if (!res.ok) throw new Error("Failed to load preview");
        const blob = await res.blob();
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setObjectUrl(url);
      } catch {
        if (!cancelled) setError(true);
      }
    }

    load();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [doc.downloadHref, online]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={`Preview of ${doc.filename}`}
        aria-modal="true"
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="truncate text-sm font-medium">{doc.filename}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="shrink-0 rounded-md p-1 text-muted hover:bg-black/5 dark:hover:bg-white/5"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex flex-1 items-center justify-center overflow-auto bg-black/5 p-4 dark:bg-white/5">
          {error ? (
            <p className="text-sm text-muted">Couldn&apos;t load a preview for this file.</p>
          ) : !objectUrl ? (
            <p className="text-sm text-muted">Loading preview…</p>
          ) : doc.mimeType === "application/pdf" ? (
            <embed src={objectUrl} type="application/pdf" className="h-[70vh] w-full" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- blob: URL, not an optimizable remote image
            <img src={objectUrl} alt={doc.filename} className="max-h-[70vh] max-w-full object-contain" />
          )}
        </div>
      </div>
    </div>
  );
}
