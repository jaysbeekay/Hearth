"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { DocumentShareButton } from "@/components/DocumentShareButton";
import { getOfflineDocument } from "@/lib/offlineDocuments";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { isPreviewable } from "@/lib/documents/documentList";
import { inlineViewHref } from "@/lib/documents/inlineView";
import { overlayClass, buttonClass } from "@/lib/ui";

export interface PreviewableDoc {
  /** The Document's id, for Share (#374); absent for an Inbox file, which can't be shared. */
  id?: string;
  filename: string;
  mimeType: string;
  downloadHref: string;
}

export { isPreviewable };

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
  const isPdf = doc.mimeType === "application/pdf";
  // Online, a PDF is framed straight from its own URL (inlineView.ts):
  // Safari won't draw one from a blob: URL under the app's CSP.
  const framesUrl = online && isPdf;

  useEffect(() => {
    if (framesUrl) return;
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
  }, [doc.downloadHref, online, framesUrl]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={`Preview of ${doc.filename}`}
        aria-modal="true"
        className={overlayClass("flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{doc.filename}</span>
          {/* #374 — the same Share and Download as the Document's row. */}
          {doc.id && (
            <DocumentShareButton
              documentId={doc.id}
              href={doc.downloadHref}
              filename={doc.filename}
              mimeType={doc.mimeType}
              labelled
            />
          )}
          <a href={doc.downloadHref} download={doc.filename} className={buttonClass("secondary")}>
            <Download size={16} aria-hidden />
            Download
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className={buttonClass("quiet", { icon: true }, "shrink-0 text-muted")}
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex flex-1 items-center justify-center overflow-auto bg-hover p-4">
          {error ? (
            <p className="text-sm text-muted">Couldn&apos;t load a preview for this file.</p>
          ) : framesUrl ? (
            <iframe
              src={inlineViewHref(doc.downloadHref)}
              title={doc.filename}
              className="h-[70vh] w-full border-0"
            />
          ) : !objectUrl ? (
            <p className="text-sm text-muted">Loading preview…</p>
          ) : isPdf ? (
            // #229 — <embed type="application/pdf"> is blocked by the app's
            // CSP (object-src 'none', deliberate). Offline there's only the
            // cached blob, so it's framed over a blob: URL. Chrome and
            // Firefox draw that; Safari doesn't (see inlineView.ts).
            <iframe src={objectUrl} title={doc.filename} className="h-[70vh] w-full border-0" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- blob: URL, not an optimizable remote image
            <img src={objectUrl} alt={doc.filename} className="max-h-[70vh] max-w-full object-contain" />
          )}
        </div>
      </div>
    </div>
  );
}
