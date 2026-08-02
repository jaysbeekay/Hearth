import { FileText, Trash2, History } from "lucide-react";
import type { DocumentModel } from "@/generated/prisma/models";
import { deleteDocumentAction, setDocumentImportant } from "@/lib/actions/contracts";
import { ConfirmForm } from "@/components/ConfirmForm";
import { DocumentLink } from "@/components/DocumentLink";
import { ImportantToggle } from "@/components/ImportantToggle";
import { formatDate, humanFileSize } from "@/lib/utils";

function DeleteButton({ doc }: { doc: DocumentModel }) {
  return (
    <ConfirmForm
      action={deleteDocumentAction.bind(null, doc.contractId, doc.id)}
      confirmText={`Delete ${doc.filename}? This can't be undone.`}
      ariaLabel={`Delete ${doc.filename}`}
      className="rounded-md p-2 text-foreground/50 hover:text-danger"
      offline={{
        entity: "contractDocument",
        entityId: doc.id,
        parentId: doc.contractId,
        label: `Delete document: ${doc.filename}`,
      }}
    >
      <Trash2 size={16} />
    </ConfirmForm>
  );
}

export function DocumentList({
  documents,
  dateFormat,
}: {
  documents: DocumentModel[];
  dateFormat?: string;
}) {
  if (documents.length === 0) {
    return <p className="text-sm text-foreground/60">No documents uploaded yet.</p>;
  }

  // #206 — group into version chains via supersedesId rather than listing
  // every re-upload as an unrelated document. A "head" is any document
  // nothing else in this list supersedes; walking backward from each head
  // recovers its full history, oldest last, with no extra query since the
  // parent page already fetched every document for this contract.
  const byId = new Map(documents.map((d) => [d.id, d]));
  const supersededIds = new Set(
    documents.filter((d) => d.supersedesId).map((d) => d.supersedesId as string),
  );
  const heads = documents.filter((d) => !supersededIds.has(d.id));

  function olderVersions(head: DocumentModel): DocumentModel[] {
    const chain: DocumentModel[] = [];
    let cursor = head.supersedesId;
    while (cursor) {
      const doc = byId.get(cursor);
      if (!doc) break;
      chain.push(doc);
      cursor = doc.supersedesId;
    }
    return chain;
  }

  return (
    <ul className="divide-y divide-border">
      {heads.map((doc) => {
        const older = olderVersions(doc);
        return (
          <li key={doc.id} className="py-3">
            <div className="flex items-center justify-between gap-3">
              <DocumentLink
                href={`/api/documents/${doc.id}`}
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
                {older.length > 0 && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent/10 px-1.5 py-0.5 text-xs font-medium text-accent">
                    Latest
                  </span>
                )}
              </DocumentLink>
              <div className="flex shrink-0 items-center gap-1">
                <ImportantToggle
                  isImportant={doc.isImportant}
                  action={setDocumentImportant.bind(null, doc.contractId, doc.id)}
                  label={doc.filename}
                />
                <DeleteButton doc={doc} />
              </div>
            </div>

            {older.length > 0 && (
              <ul className="ml-6 mt-2 space-y-2 border-l border-border pl-4">
                {older.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-3">
                    <DocumentLink
                      href={`/api/documents/${v.id}`}
                      filename={v.filename}
                      mimeType={v.mimeType}
                      size={v.size}
                      className="flex min-w-0 items-center gap-2 text-xs text-foreground/60 hover:text-accent"
                    >
                      <History size={14} className="shrink-0" />
                      <span className="min-w-0 truncate">{v.filename}</span>
                      <span className="shrink-0">
                        {humanFileSize(v.size)} · {formatDate(v.uploadedAt, dateFormat)}
                      </span>
                    </DocumentLink>
                    <DeleteButton doc={v} />
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
