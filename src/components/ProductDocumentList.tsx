import { FileText, Trash2 } from "lucide-react";
import type { ProductDocumentModel } from "@/generated/prisma/models";
import { deleteProductDocumentAction } from "@/lib/actions/products";
import { ConfirmForm } from "@/components/ConfirmForm";
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
  if (documents.length === 0) {
    return <p className="text-sm text-foreground/60">No documents uploaded yet.</p>;
  }

  return (
    <ul className="divide-y divide-border">
      {documents.map((doc) => (
        <li key={doc.id} className="flex items-center justify-between gap-3 py-3">
          <a
            href={`/api/products/documents/${doc.id}`}
            className="flex min-w-0 items-center gap-3 text-sm hover:text-accent"
          >
            {doc.kind === "PHOTO" && doc.mimeType.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/products/documents/${doc.id}`}
                alt={doc.filename}
                className="h-10 w-10 shrink-0 rounded-md object-cover"
              />
            ) : (
              <FileText size={18} className="shrink-0 text-foreground/50" />
            )}
            <span className="min-w-0 truncate">{doc.filename}</span>
            <span className="shrink-0 text-foreground/50">
              {KIND_LABELS[doc.kind] ?? doc.kind} · {humanFileSize(doc.size)} ·{" "}
              {formatDate(doc.uploadedAt, dateFormat)}
            </span>
          </a>
          <ConfirmForm
            action={deleteProductDocumentAction.bind(null, doc.productId, doc.id)}
            confirmText={`Delete ${doc.filename}? This can't be undone.`}
            ariaLabel={`Delete ${doc.filename}`}
            className="rounded-md p-2 text-foreground/50 hover:text-danger"
          >
            <Trash2 size={16} />
          </ConfirmForm>
        </li>
      ))}
    </ul>
  );
}
