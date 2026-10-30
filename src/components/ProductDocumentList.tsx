"use client";

import { Timestamp } from "@/components/Timestamp";
import { useState } from "react";
import { Eye, FileText } from "lucide-react";
import type { ProductDocumentModel } from "@/generated/prisma/models";
import { setDocumentImportantAction } from "@/lib/actions/documents";
import { DocumentDeleteButton } from "@/components/DocumentDeleteButton";
import { DocumentLink } from "@/components/DocumentLink";
import { DocumentPreviewModal, isPreviewable } from "@/components/DocumentPreviewModal";
import { ImportantToggle } from "@/components/ImportantToggle";
import { ProductDocumentThumbnail } from "@/components/ProductDocumentThumbnail";
import { documentFileHref } from "@/lib/documents/kinds";
import { humanFileSize } from "@/lib/utils";

const KIND_LABELS: Record<string, string> = {
  INVOICE: "Invoice",
  PHOTO: "Photo",
  MANUAL: "Manual",
  OTHER: "Other",
};

export function ProductDocumentList({
  documents,
}: {
  documents: ProductDocumentModel[];
}) {
  const [preview, setPreview] = useState<ProductDocumentModel | null>(null);

  if (documents.length === 0) {
    return <p className="text-sm text-muted">No documents uploaded yet.</p>;
  }

  return (
    <ul className="divide-y divide-border">
      {documents.map((doc) => (
        <li key={doc.id} className="flex items-center justify-between gap-3 py-3">
          {/* #403 — below sm the filename gets its own line with the
              kind/size/date metadata under it; the single flex line let the
              shrink-0 metadata overflow the link and collide with the
              download/preview buttons at 390px. */}
          <DocumentLink
            href={documentFileHref(doc.id)}
            filename={doc.filename}
            mimeType={doc.mimeType}
            size={doc.size}
            className="flex min-w-0 flex-col gap-0.5 text-sm hover:text-accent sm:flex-row sm:items-center sm:gap-3"
          >
            <span className="flex min-w-0 items-center gap-3">
              {doc.kind === "PHOTO" && doc.mimeType.startsWith("image/") ? (
                <ProductDocumentThumbnail
                  href={documentFileHref(doc.id)}
                  filename={doc.filename}
                />
              ) : (
                <FileText size={18} className="shrink-0 text-muted" />
              )}
              <span className="min-w-0 truncate">{doc.filename}</span>
            </span>
            <span className="min-w-0 text-muted sm:shrink-0">
              {KIND_LABELS[doc.kind] ?? doc.kind} · {humanFileSize(doc.size)} ·{" "}
              <Timestamp value={doc.uploadedAt} />
            </span>
          </DocumentLink>
          <div className="flex shrink-0 items-center gap-1">
            {isPreviewable(doc.mimeType) && (
              <button
                type="button"
                onClick={() => setPreview(doc)}
                aria-label={`Preview ${doc.filename}`}
                className="rounded-md p-2 text-muted hover:bg-hover"
              >
                <Eye size={16} />
              </button>
            )}
            <ImportantToggle
              isImportant={doc.isImportant}
              action={setDocumentImportantAction.bind(null, "PRODUCT", doc.id)}
              label={doc.filename}
            />
            <DocumentDeleteButton
              kind="PRODUCT"
              documentId={doc.id}
              ownerId={doc.productId}
              filename={doc.filename}
            />
          </div>
        </li>
      ))}

      {preview && (
        <DocumentPreviewModal
          doc={{
            filename: preview.filename,
            mimeType: preview.mimeType,
            downloadHref: documentFileHref(preview.id),
          }}
          onClose={() => setPreview(null)}
        />
      )}
    </ul>
  );
}
