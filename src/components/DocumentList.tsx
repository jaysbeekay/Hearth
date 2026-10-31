import { Timestamp } from "@/components/Timestamp";
import { FileText, History } from "lucide-react";
import { setDocumentImportantAction } from "@/lib/actions/documents";
import { DocumentDeleteButton } from "@/components/DocumentDeleteButton";
import { DocumentLink } from "@/components/DocumentLink";
import { DocumentPreviewButton } from "@/components/DocumentPreviewButton";
import { DocumentThumbnail } from "@/components/DocumentThumbnail";
import { ImportantToggle } from "@/components/ImportantToggle";
import { documentFileHref, type OwnedDocumentKind } from "@/lib/documents/kinds";
import {
  documentTypeLabel,
  groupDocumentVersions,
  olderVersionShowsStar,
  showsThumbnail,
  type DocumentListRow,
  type DocumentVersionLink,
} from "@/lib/documents/documentList";
import { humanFileSize } from "@/lib/utils";
import { Pill } from "@/components/ui";

// #397 — the one Document list, for every kind of record. Each Document
// shows its type, a star, a preview where the browser can show the file,
// and a delete to Trash with Undo; re-uploads are grouped under the latest
// version (#206). A server component, so the page (and its offline copy)
// renders the list without a client fetch.

type Row = DocumentListRow & {
  /** A Warranty Document's legacy kind (PRODUCT rows only). */
  kind?: string;
};

function TypePill({ label }: { label: string | null }) {
  if (!label) return null;
  return <Pill>{label}</Pill>;
}

export function DocumentList({
  kind,
  ownerId,
  documents,
  trashedLinks,
}: {
  kind: OwnedDocumentKind;
  /** The record every Document in the list belongs to. */
  ownerId: string;
  documents: Row[];
  /**
   * Version links of this record's Documents in Trash (getTrashedVersionLinks),
   * so a version in Trash doesn't split its Document in two.
   */
  trashedLinks?: DocumentVersionLink[];
}) {
  if (documents.length === 0) {
    return <p className="text-sm text-muted">No documents uploaded yet.</p>;
  }

  const productKind = (doc: Row) => (kind === "PRODUCT" ? doc.kind : undefined);
  const star = (doc: Row) => (
    <ImportantToggle
      isImportant={doc.isImportant}
      action={setDocumentImportantAction.bind(null, kind, doc.id)}
      label={doc.filename}
    />
  );

  return (
    <ul className="divide-y divide-border">
      {groupDocumentVersions(documents, trashedLinks).map(({ latest: doc, older }) => {
        const href = documentFileHref(doc.id);
        return (
          <li key={doc.id} className="py-2">
            <div className="flex items-center justify-between gap-3">
              {/* #403 — below sm the filename and its metadata stack instead
                  of sharing one line, which squeezed the filename at 390px. */}
              <DocumentLink
                href={href}
                filename={doc.filename}
                mimeType={doc.mimeType}
                size={doc.size}
                className="flex min-w-0 flex-col gap-0.5 text-sm hover:text-accent sm:flex-row sm:items-center sm:gap-2"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {showsThumbnail(doc, productKind(doc)) ? (
                    <DocumentThumbnail href={href} />
                  ) : (
                    <FileText size={16} className="shrink-0 text-muted" />
                  )}
                  <span className="min-w-0 truncate">{doc.filename}</span>
                </span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:shrink-0">
                  <span className="text-muted">
                    {humanFileSize(doc.size)} · <Timestamp value={doc.uploadedAt} />
                  </span>
                  <TypePill label={documentTypeLabel(doc, productKind(doc))} />
                  {older.length > 0 && (
                    <Pill>
                      Latest
                    </Pill>
                  )}
                </span>
              </DocumentLink>
              <div className="flex shrink-0 items-center">
                <DocumentPreviewButton href={href} filename={doc.filename} mimeType={doc.mimeType} />
                {star(doc)}
                <DocumentDeleteButton kind={kind} documentId={doc.id} ownerId={ownerId} filename={doc.filename} />
              </div>
            </div>

            {older.length > 0 && (
              <ul aria-label={`Older versions of ${doc.filename}`} className="ml-6 mt-1 border-l border-border pl-4">
                {older.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-3">
                    <DocumentLink
                      href={documentFileHref(v.id)}
                      filename={v.filename}
                      mimeType={v.mimeType}
                      size={v.size}
                      className="flex min-w-0 flex-col gap-0.5 text-xs text-muted hover:text-accent sm:flex-row sm:items-center sm:gap-2"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <History size={16} className="shrink-0" />
                        <span className="min-w-0 truncate">{v.filename}</span>
                      </span>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:shrink-0">
                        <span>
                          {humanFileSize(v.size)} · <Timestamp value={v.uploadedAt} />
                        </span>
                        <TypePill label={documentTypeLabel(v, productKind(v))} />
                      </span>
                    </DocumentLink>
                    <div className="flex shrink-0 items-center">
                      <DocumentPreviewButton
                        href={documentFileHref(v.id)}
                        filename={v.filename}
                        mimeType={v.mimeType}
                      />
                      {olderVersionShowsStar(v) && star(v)}
                      <DocumentDeleteButton kind={kind} documentId={v.id} ownerId={ownerId} filename={v.filename} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
