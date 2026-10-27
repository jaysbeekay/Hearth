import { Timestamp } from "@/components/Timestamp";
import { FileText } from "lucide-react";
import type { VehicleItemDocumentModel } from "@/generated/prisma/models";
import { DocumentDeleteButton } from "@/components/DocumentDeleteButton";
import { DocumentLink } from "@/components/DocumentLink";
import { documentFileHref } from "@/lib/documents/kinds";
import { humanFileSize } from "@/lib/utils";

export function VehicleItemDocumentList({
  documents,
  dateFormat,
}: {
  documents: VehicleItemDocumentModel[];
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
            className="flex min-w-0 items-center gap-2 text-sm hover:text-accent"
          >
            <FileText size={18} className="shrink-0 text-muted" />
            <span className="min-w-0 truncate">{doc.filename}</span>
            <span className="shrink-0 text-muted">
              {humanFileSize(doc.size)} · <Timestamp value={doc.uploadedAt} dateFormat={dateFormat} />
            </span>
          </DocumentLink>
          <DocumentDeleteButton
            kind="VEHICLE_ITEM"
            documentId={doc.id}
            ownerId={doc.vehicleItemId}
            filename={doc.filename}
          />
        </li>
      ))}
    </ul>
  );
}
