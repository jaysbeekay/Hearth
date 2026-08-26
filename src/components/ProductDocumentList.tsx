"use client";

import { useState } from "react";
import { Eye, FileText, Trash2 } from "lucide-react";
import type { ProductDocumentModel } from "@/generated/prisma/models";
import { deleteProductDocumentAction, setProductDocumentImportant } from "@/lib/actions/products";
import { ConfirmForm } from "@/components/ConfirmForm";
import { DocumentLink } from "@/components/DocumentLink";
import { DocumentPreviewModal, isPreviewable } from "@/components/DocumentPreviewModal";
import { ImportantToggle } from "@/components/ImportantToggle";
import { ProductDocumentThumbnail } from "@/components/ProductDocumentThumbnail";
import { formatDate, humanFileSize } from "@/lib/utils";

const KIND_LABELS: Record<string, string> = {
  INVOICE: "Invoice",
  PHOTO: "Photo",
  MANUAL: "Manual",
  OTHER: "Other",
};

export function ProductDocumentList({
  documents,
  dateFormat,
}: {
  documents: ProductDocumentModel[];
  dateFormat?: string;
}) {
  const [preview, setPreview] = useState<ProductDocumentModel | null>(null);

  if (documents.length === 0) {
    return <p className="text-sm text-muted">No documents uploaded yet.</p>;
  }

  return (
    <ul className="divide-y divide-border">
      {documents.map((doc) => (
        <li key={doc.id} className="flex items-center justify-between gap-3 py-3">
          <DocumentLink
            href={`/api/products/documents/${doc.id}`}
            filename={doc.filename}
            mimeType={doc.mimeType}
            size={doc.size}
            className="flex min-w-0 items-center gap-3 text-sm hover:text-accent"
          >
            {doc.kind === "PHOTO" && doc.mimeType.startsWith("image/") ? (
              <ProductDocumentThumbnail
                href={`/api/products/documents/${doc.id}`}
                filename={doc.filename}
              />
            ) : (
              <FileText size={18} className="shrink-0 text-muted" />
            )}
            <span className="min-w-0 truncate">{doc.filename}</span>
            <span className="shrink-0 text-muted">
              {KIND_LABELS[doc.kind] ?? doc.kind} · {humanFileSize(doc.size)} ·{" "}
              {formatDate(doc.uploadedAt, dateFormat)}
            </span>
          </DocumentLink>
          <div className="flex items-center gap-1">
            {isPreviewable(doc.mimeType) && (
              <button
                type="button"
                onClick={() => setPreview(doc)}
                aria-label={`Preview ${doc.filename}`}
                className="rounded-md p-2 text-muted hover:bg-black/5 dark:hover:bg-white/5"
              >
                <Eye size={16} />
              </button>
            )}
            <ImportantToggle
              isImportant={doc.isImportant}
              action={setProductDocumentImportant.bind(null, doc.productId, doc.id)}
              label={doc.filename}
            />
            <ConfirmForm
              action={deleteProductDocumentAction.bind(null, doc.productId, doc.id)}
              confirmText={`Delete ${doc.filename}? This can't be undone.`}
              ariaLabel={`Delete ${doc.filename}`}
              className="rounded-md p-2 text-muted hover:text-danger"
              offline={{
                entity: "productDocument",
                entityId: doc.id,
                parentId: doc.productId,
                label: `Delete document: ${doc.filename}`,
              }}
            >
              <Trash2 size={16} />
            </ConfirmForm>
          </div>
        </li>
      ))}

      {preview && (
        <DocumentPreviewModal
          doc={{
            filename: preview.filename,
            mimeType: preview.mimeType,
            downloadHref: `/api/products/documents/${preview.id}`,
          }}
          onClose={() => setPreview(null)}
        />
      )}
    </ul>
  );
}
