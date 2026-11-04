"use client";

import { useState } from "react";
import { Eye } from "lucide-react";
import { DocumentPreviewModal, isPreviewable } from "@/components/DocumentPreviewModal";
import { buttonClass } from "@/lib/ui";

// The Document list's preview (#397): the button and its modal, so the list
// itself can stay a server component. Nothing for a file the browser can't
// show.
export function DocumentPreviewButton({
  documentId,
  href,
  filename,
  mimeType,
}: {
  /** For the modal's Share (#374). */
  documentId?: string;
  href: string;
  filename: string;
  mimeType: string;
}) {
  const [open, setOpen] = useState(false);
  if (!isPreviewable(mimeType)) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        aria-label={`Preview ${filename}`}
        className={buttonClass("quiet", { icon: true }, "text-muted")}
      >
        <Eye size={16} />
      </button>
      {open && (
        <DocumentPreviewModal
          doc={{ id: documentId, filename, mimeType, downloadHref: href }}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
