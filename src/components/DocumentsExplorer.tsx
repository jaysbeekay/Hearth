"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FileText, Image as ImageIcon, Eye, X, Upload } from "lucide-react";
import { SelectWrapper } from "@/components/SelectWrapper";
import { DocumentLink } from "@/components/DocumentLink";
import { getOfflineDocument } from "@/lib/offlineDocuments";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { formatDate, humanFileSize } from "@/lib/utils";

export interface DocRow {
  id: string;
  filename: string;
  size: number;
  uploadedAt: Date;
  mimeType: string;
  type: string;
  parentTitle: string;
  parentHref: string;
  downloadHref: string;
}

type SortKey = "date-desc" | "date-asc" | "name-asc" | "size-desc";

const SORT_LABELS: Record<SortKey, string> = {
  "date-desc": "Newest first",
  "date-asc": "Oldest first",
  "name-asc": "Filename (A–Z)",
  "size-desc": "Largest first",
};

function isPreviewable(mimeType: string) {
  return mimeType.startsWith("image/") || mimeType === "application/pdf";
}

export function DocumentsExplorer({
  docs,
  dateFormat,
  emptyMessage,
}: {
  docs: DocRow[];
  dateFormat?: string;
  /** Shown when a type filter has no matches; null means no documents exist at all. */
  emptyMessage: string | null;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("date-desc");
  const [preview, setPreview] = useState<DocRow | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? docs.filter(
          (d) => d.filename.toLowerCase().includes(q) || d.parentTitle.toLowerCase().includes(q),
        )
      : docs;

    const sorted = [...matched];
    switch (sort) {
      case "date-asc":
        sorted.sort((a, b) => a.uploadedAt.getTime() - b.uploadedAt.getTime());
        break;
      case "name-asc":
        sorted.sort((a, b) => a.filename.localeCompare(b.filename));
        break;
      case "size-desc":
        sorted.sort((a, b) => b.size - a.size);
        break;
      default:
        sorted.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
    }
    return sorted;
  }, [docs, query, sort]);

  if (docs.length === 0) {
    if (emptyMessage) {
      return (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
          {emptyMessage}
        </p>
      );
    }
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-10 text-center">
        <p className="text-sm text-muted">No documents uploaded yet.</p>
        <Link
          href="/import"
          className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
        >
          <Upload size={16} />
          Upload a document
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by filename or record…"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent sm:max-w-xs"
        />
        <SelectWrapper>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-lg border border-border bg-background px-3 h-9 text-sm outline-none focus:border-accent appearance-none pr-8"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
              <option key={key} value={key}>
                {SORT_LABELS[key]}
              </option>
            ))}
          </select>
        </SelectWrapper>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
          No documents match &quot;{query}&quot;.
        </p>
      ) : (
        <>
          {/* Table — md and up */}
          <div className="hidden overflow-x-auto rounded-xl border border-border bg-surface md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-4 py-2 font-medium">File</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Belongs to</th>
                  <th className="px-4 py-2 font-medium">Uploaded</th>
                  <th className="px-4 py-2 text-right font-medium">Size</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {visible.map((doc) => (
                  <tr key={`${doc.type}-${doc.id}`} className="border-b border-border last:border-0">
                    <td className="max-w-xs px-4 py-2">
                      <DocumentLink
                        href={doc.downloadHref}
                        filename={doc.filename}
                        mimeType={doc.mimeType}
                        size={doc.size}
                        className="flex items-center gap-2 hover:underline"
                      >
                        <FileIcon mimeType={doc.mimeType} />
                        <span className="truncate">{doc.filename}</span>
                      </DocumentLink>
                    </td>
                    <td className="px-4 py-2">
                      <span className="rounded-full bg-info/10 px-2 py-0.5 text-xs font-medium text-info">
                        {doc.type}
                      </span>
                    </td>
                    <td className="max-w-xs px-4 py-2">
                      <Link href={doc.parentHref} className="truncate text-accent hover:underline">
                        {doc.parentTitle}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-muted">
                      {formatDate(doc.uploadedAt, dateFormat)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-muted">
                      {humanFileSize(doc.size)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {isPreviewable(doc.mimeType) && (
                        <button
                          type="button"
                          onClick={() => setPreview(doc)}
                          aria-label={`Preview ${doc.filename}`}
                          className="rounded-md p-1 text-muted hover:bg-black/5 dark:hover:bg-white/5"
                        >
                          <Eye size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Cards — below md */}
          <div className="grid gap-2 md:hidden">
            {visible.map((doc) => (
              <div
                key={`${doc.type}-${doc.id}`}
                className="rounded-xl border border-border bg-surface p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <DocumentLink
                    href={doc.downloadHref}
                    filename={doc.filename}
                    mimeType={doc.mimeType}
                    size={doc.size}
                    className="flex min-w-0 items-center gap-2 hover:underline"
                  >
                    <FileIcon mimeType={doc.mimeType} />
                    <span className="truncate text-sm font-medium">{doc.filename}</span>
                  </DocumentLink>
                  {isPreviewable(doc.mimeType) && (
                    <button
                      type="button"
                      onClick={() => setPreview(doc)}
                      aria-label={`Preview ${doc.filename}`}
                      className="shrink-0 rounded-md p-1 text-muted hover:bg-black/5 dark:hover:bg-white/5"
                    >
                      <Eye size={16} />
                    </button>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  <span className="rounded-full bg-info/10 px-2 py-0.5 font-medium text-info">
                    {doc.type}
                  </span>
                  <Link href={doc.parentHref} className="text-accent hover:underline">
                    {doc.parentTitle}
                  </Link>
                  <span>{formatDate(doc.uploadedAt, dateFormat)}</span>
                  <span className="tabular-nums">{humanFileSize(doc.size)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {preview && <PreviewModal doc={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

function FileIcon({ mimeType }: { mimeType: string }) {
  const Icon = mimeType.startsWith("image/") ? ImageIcon : FileText;
  return <Icon size={14} className="shrink-0 text-muted" />;
}

function PreviewModal({ doc, onClose }: { doc: DocRow; onClose: () => void }) {
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
