import { FileText, Trash2 } from "lucide-react";
import type { InventoryItemDocumentModel } from "@/generated/prisma/models";
import { deleteInventoryItemDocumentAction } from "@/lib/actions/inventory";
import { ConfirmForm } from "@/components/ConfirmForm";
import { DocumentLink } from "@/components/DocumentLink";
import { formatDate, humanFileSize } from "@/lib/utils";

export function InventoryItemDocumentList({
  documents,
  dateFormat,
}: {
  documents: InventoryItemDocumentModel[];
  dateFormat?: string;
}) {
  if (documents.length === 0) {
    return <p className="text-sm text-foreground/60">No documents uploaded yet.</p>;
  }

  return (
    <ul className="divide-y divide-border">
      {documents.map((doc) => (
        <li key={doc.id} className="flex items-center justify-between gap-3 py-3">
          <DocumentLink
            href={`/api/inventory/documents/${doc.id}`}
            filename={doc.filename}
            mimeType={doc.mimeType}
            size={doc.size}
            className="flex min-w-0 items-center gap-2 text-sm hover:text-accent"
          >
            <FileText size={18} className="shrink-0 text-foreground/50" />
            <span className="min-w-0 truncate">{doc.filename}</span>
            <span className="shrink-0 text-foreground/50">
              {humanFileSize(doc.size)} · {formatDate(doc.uploadedAt, dateFormat)}
            </span>
          </DocumentLink>
          <ConfirmForm
            action={deleteInventoryItemDocumentAction.bind(null, doc.inventoryItemId, doc.id)}
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
