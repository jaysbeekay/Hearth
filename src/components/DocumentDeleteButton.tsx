import { Trash2 } from "lucide-react";
import { deleteDocumentAction, restoreDocumentAction } from "@/lib/actions/documents";
import { ConfirmForm } from "@/components/ConfirmForm";
import { WriteOnly } from "@/components/CanWriteProvider";
import type { OwnedDocumentKind } from "@/lib/documents/kinds";

// #396 — the same delete for a Document of every kind: to Trash, with Undo,
// and queued as a `document` sync op when offline.
export function DocumentDeleteButton({
  kind,
  documentId,
  ownerId,
  filename,
  className = "inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:text-danger",
  iconSize = 16,
}: {
  kind: OwnedDocumentKind;
  documentId: string;
  ownerId: string;
  filename: string;
  className?: string;
  iconSize?: number;
}) {
  // #400 — read-only members don't get a delete they can't use.
  return (
    <WriteOnly>
      <ConfirmForm
        action={deleteDocumentAction.bind(null, kind, documentId, ownerId)}
        undo={{ action: restoreDocumentAction.bind(null, kind, documentId) }}
        confirmText={`Delete ${filename}? You can restore it within 30 days from Settings → Recently deleted.`}
        ariaLabel={`Delete ${filename}`}
        className={className}
        offline={{
          entity: "document",
          kind,
          entityId: documentId,
          parentId: ownerId,
          label: `Delete ${filename}`,
        }}
      >
        <Trash2 size={iconSize} />
      </ConfirmForm>
    </WriteOnly>
  );
}
