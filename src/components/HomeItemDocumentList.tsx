import { Timestamp } from "@/components/Timestamp";
import { FileText } from "lucide-react";
import type { HomeItemDocumentModel } from "@/generated/prisma/models";
import { DocumentDeleteButton } from "@/components/DocumentDeleteButton";
import { DocumentLink } from "@/components/DocumentLink";
import { documentFileHref } from "@/lib/documents/kinds";
import { humanFileSize } from "@/lib/utils";

export function HomeItemDocumentList({
  documents,
  dateFormat,
}: {
  documents: HomeItemDocumentModel[];
  dateFormat?: string;
}) {
  if (documents.length === 0) {
    return <p className="text-sm text-muted">No documents uploaded yet.</p>;
  }

  return (
    <ul className="divide-y divide-border">
      {documents.map((doc) => (
        <li key={doc.id} className="flex items-center justify-between gap-3 py-3">
          <DocumentLink
            href={documentFileHref(doc.id)}
            filename={doc.filename}
            mimeType={doc.mimeType}
            size={doc.size}
            className="flex min-w-0 flex-col gap-0.5 text-sm hover:text-accent sm:flex-row sm:items-center sm:gap-2"
          >
            {/* #403 — filename and metadata stack below sm instead of sharing
                one flex line, which squeezed the filename to a few characters. */}
            <span className="flex min-w-0 items-center gap-2">
              <FileText size={18} className="shrink-0 text-muted" />
              <span className="min-w-0 truncate">{doc.filename}</span>
            </span>
            <span className="text-muted sm:shrink-0">
              {humanFileSize(doc.size)} · <Timestamp value={doc.uploadedAt} dateFormat={dateFormat} />
            </span>
          </DocumentLink>
          <DocumentDeleteButton
            kind="HOME_ITEM"
            documentId={doc.id}
            ownerId={doc.homeItemId}
            filename={doc.filename}
          />
        </li>
      ))}
    </ul>
  );
}
