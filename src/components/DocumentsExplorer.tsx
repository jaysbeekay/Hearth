"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FileText, Image as ImageIcon, Eye, Upload } from "lucide-react";
import { SelectWrapper, inputClass } from "@/components/SelectWrapper";
import { linkButtonClass } from "@/lib/buttonStyles";
import { DocumentLink } from "@/components/DocumentLink";
import { DocumentPreviewModal, isPreviewable } from "@/components/DocumentPreviewModal";
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
        <Link href="/import" className={linkButtonClass("primary")}>
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
          // #252: docs is now one bounded, paginated page rather than the
          // household's entire document history, so this only searches
          // what's currently loaded — the global search bar (⌘K) covers
          // every document regardless of page.
          placeholder="Search this page by filename or record…"
          className={`${inputClass} sm:max-w-xs`}
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

      {preview && <DocumentPreviewModal doc={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

function FileIcon({ mimeType }: { mimeType: string }) {
  const Icon = mimeType.startsWith("image/") ? ImageIcon : FileText;
  return <Icon size={14} className="shrink-0 text-muted" />;
}
