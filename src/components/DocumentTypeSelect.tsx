"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setDocumentCategoryAction } from "@/lib/actions/documents";
import { useCanWrite } from "@/components/CanWriteProvider";
import { showToast } from "@/components/Toast";
import { DOCUMENT_CATEGORIES, documentCategoryLabel } from "@/lib/documents/categories";
import type { OwnedDocumentKind } from "@/lib/documents/kinds";
import { pillClass } from "@/lib/ui";

/**
 * #405 — a Document's type, set inline on its row. Writers get a select
 * that looks like the type pill; read-only members see the pill alone.
 * An untyped Document (one added with "Add document") reads "Set type".
 */
export function DocumentTypeSelect({
  kind,
  documentId,
  ownerId,
  filename,
  category,
}: {
  kind: OwnedDocumentKind;
  documentId: string;
  ownerId: string;
  filename: string;
  category: string | null;
}) {
  const canWrite = useCanWrite();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const label = documentCategoryLabel(category);
  const known = label ? (category ?? "") : "";
  // The picked type shows straight away, not after the save and refresh;
  // it goes back only if the save fails. A new value from the server (a
  // refresh after someone else's change) replaces it.
  const [picked, setPicked] = useState({ server: known, value: known });
  if (picked.server !== known) setPicked({ server: known, value: known });

  if (!canWrite) {
    return label ? <span className={pillClass()}>{label}</span> : null;
  }

  return (
    <select
      aria-label={`Document type for ${filename}`}
      value={picked.value}
      disabled={pending}
      onClick={(e) => { e.stopPropagation(); }}
      onChange={(e) => {
        const next = e.currentTarget.value;
        const previous = picked.value;
        setPicked({ server: known, value: next });
        startTransition(async () => {
          const result = await setDocumentCategoryAction(kind, documentId, ownerId, next);
          if (result?.error) {
            setPicked({ server: known, value: previous });
            showToast(result.error, "error");
          } else {
            router.refresh();
          }
        });
      }}
      className={pillClass("neutral", "cursor-pointer border-0 outline-none focus:ring-1 focus:ring-accent")}
    >
      {!picked.value && <option value="">Set type</option>}
      {DOCUMENT_CATEGORIES.map((c) => (
        <option key={c} value={c}>
          {documentCategoryLabel(c)}
        </option>
      ))}
    </select>
  );
}
