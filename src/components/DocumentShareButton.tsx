"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Share2 } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { showToast } from "@/components/Toast";
import { useCanWrite } from "@/components/CanWriteProvider";
import { createDocumentShareLink, revokeDocumentShareLink } from "@/lib/actions/documentShare";
import { getOfflineDocument } from "@/lib/offlineDocuments";
import { buttonClass, inputClass } from "@/lib/ui";

// #374 — Share for a Document. Where the browser can hand a file to the
// share sheet (phones, some desktops), the file itself is shared. Elsewhere
// a link that works for a day is made and copied (or handed to the share
// sheet as a URL). Read-only members can share the file but can't make links.

function shareSupportsFiles(filename: string, mimeType: string): boolean {
  if (typeof navigator === "undefined" || typeof navigator.canShare !== "function") return false;
  try {
    return navigator.canShare({ files: [new File([""], filename, { type: mimeType })] });
  } catch {
    return false;
  }
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";
const isNotAllowed = (error: unknown) => error instanceof DOMException && error.name === "NotAllowedError";

export function DocumentShareButton({
  documentId,
  href,
  filename,
  mimeType,
  labelled = false,
}: {
  documentId: string;
  /** The Document's file route. */
  href: string;
  filename: string;
  mimeType: string;
  /** A labelled button (the preview modal) rather than an icon (list rows). */
  labelled?: boolean;
}) {
  const canWrite = useCanWrite();
  const [pending, setPending] = useState(false);
  const [manual, setManual] = useState<{ url: string; hours: number } | null>(null);
  // A file fetched for a share the browser then refused (Safari drops the
  // tap's permission while the file downloads): the next tap shares it at once.
  const ready = useRef<File | null>(null);

  async function shareFile(file: File) {
    try {
      await navigator.share({ files: [file], title: filename });
      ready.current = null;
    } catch (error) {
      if (isAbort(error)) return;
      if (isNotAllowed(error)) {
        ready.current = file;
        showToast("Ready to share. Tap Share again.");
        return;
      }
      throw error;
    }
  }

  async function loadFile(): Promise<File> {
    if (!navigator.onLine) {
      const cached = await getOfflineDocument(href);
      if (!cached) throw new Error("offline");
      return new File([cached.blob], filename, { type: mimeType });
    }
    const res = await fetch(href);
    if (!res.ok) throw new Error("fetch failed");
    return new File([await res.blob()], filename, { type: mimeType });
  }

  async function shareLink() {
    if (!navigator.onLine) {
      showToast("Sharing a link needs a connection.", "error");
      return;
    }
    const result = await createDocumentShareLink(documentId);
    if ("error" in result) {
      showToast(result.error, "error");
      return;
    }
    const url = new URL(result.path, window.location.origin).toString();
    const revoke = {
      label: "Revoke",
      onClick: async () => {
        const revoked = await revokeDocumentShareLink(result.id);
        showToast(revoked.error ?? "Link revoked.", revoked.error ? "error" : "success");
      },
    };
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ url, title: filename });
        showToast(`Shared a link that works for ${result.hours} hours.`, "success", { action: revoke });
        return;
      } catch (error) {
        if (isAbort(error)) return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast(`Link copied. It works for ${result.hours} hours.`, "success", { action: revoke });
    } catch {
      setManual({ url, hours: result.hours });
    }
  }

  async function onShare() {
    if (pending) return;
    if (ready.current) {
      await shareFile(ready.current);
      return;
    }
    setPending(true);
    try {
      if (shareSupportsFiles(filename, mimeType)) {
        try {
          await shareFile(await loadFile());
          return;
        } catch (error) {
          if (!canWrite) {
            showToast("Couldn't share this file.", "error");
            return;
          }
          if (error instanceof Error && error.message === "offline") {
            showToast("This file isn't saved for offline use.", "error");
            return;
          }
          // Fall through to a link.
        }
      }
      if (!canWrite) {
        showToast("Read-only members can't make share links.", "error");
        return;
      }
      await shareLink();
    } catch {
      showToast("Couldn't share this file.", "error");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          void onShare();
        }}
        disabled={pending}
        aria-label={labelled ? undefined : `Share ${filename}`}
        className={
          labelled
            ? `${buttonClass("secondary")} disabled:opacity-50`
            : buttonClass("quiet", { icon: true }, "text-muted disabled:opacity-50")
        }
      >
        <Share2 size={16} aria-hidden={labelled || undefined} />
        {labelled && "Share"}
      </button>
      <Dialog
        open={manual != null}
        onClose={() => {
          setManual(null);
        }}
        label="Share link"
      >
        <p className="text-sm">
          Copy this link to share {filename}. It works for {manual?.hours} hours.
        </p>
        <input
          readOnly
          value={manual?.url ?? ""}
          aria-label="Share link"
          onFocus={(e) => {
            e.currentTarget.select();
          }}
          className={`${inputClass} mt-3 w-full`}
        />
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => {
              setManual(null);
            }}
            className={buttonClass("secondary")}
          >
            Done
          </button>
        </div>
      </Dialog>
    </>
  );
}

/** Revoke for one link on the Security page's Shared links list. */
export function ShareLinkRevokeButton({ linkId, filename }: { linkId: string; filename: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function revoke() {
    setPending(true);
    try {
      const result = await revokeDocumentShareLink(linkId);
      showToast(result.error ?? "Link revoked.", result.error ? "error" : "success");
      router.refresh();
    } finally {
      setPending(false);
    }
  }
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={`Revoke the link to ${filename}`}
      onClick={() => {
        void revoke();
      }}
      className={`${buttonClass("secondary")} disabled:opacity-50`}
    >
      Revoke
    </button>
  );
}
