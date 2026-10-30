"use client";

import { useState } from "react";
import { Eye } from "lucide-react";
import { DocumentPreviewModal, isPreviewable } from "@/components/DocumentPreviewModal";

// The Document list's preview (#397): the button and its modal, so the list
// itself can stay a server component. Nothing for a file the browser can't
// show.
export function DocumentPreviewButton({
  href,
  filename,
  mimeType,
}: {
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
        className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted hover:bg-hover"
      >
        <Eye size={16} />
      </button>
      {open && (
        <DocumentPreviewModal
          doc={{ filename, mimeType, downloadHref: href }}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
