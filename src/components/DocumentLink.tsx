"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { downloadForOffline, getOfflineDocument } from "@/lib/offlineDocuments";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { showToast } from "@/components/Toast";

// Wraps a document download <a> so it also works offline once explicitly
// downloaded — replaces the plain `<a href="/api/.../documents/{id}">` used
// across every *DocumentList.tsx component. `children` is that anchor's
// existing content (icon/filename/meta) — this only changes click/offline
// behavior and adds a small pin-for-offline button alongside it.
export function DocumentLink({
  href,
  filename,
  mimeType,
  size,
  className,
  children,
}: {
  href: string;
  filename: string;
  mimeType: string;
  size: number;
  className?: string;
  children: React.ReactNode;
}) {
  const online = useOnlineStatus();
  const [cached, setCached] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    getOfflineDocument(href)
      .then((doc) => setCached(!!doc))
      .catch(() => {});
  }, [href]);

  async function handleClick(e: React.MouseEvent) {
    if (online) return; // normal network download/view
    e.preventDefault();
    const doc = await getOfflineDocument(href);
    if (!doc) {
      showToast("Not available offline.", "error");
      return;
    }
    const blobUrl = URL.createObjectURL(doc.blob);
    window.open(blobUrl, "_blank");
    // Give the new tab time to actually load the blob before revoking it.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  }

  async function handleDownload(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDownloading(true);
    try {
      await downloadForOffline(href, { filename, mimeType, size });
      setCached(true);
      showToast("Available offline.");
    } catch {
      showToast("Couldn't download for offline use.", "error");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <span className="flex min-w-0 items-center">
      <a
        href={href}
        onClick={handleClick}
        className={!online && !cached ? `${className} opacity-50` : className}
        aria-disabled={!online && !cached}
      >
        {children}
      </a>
      <button
        type="button"
        onClick={handleDownload}
        disabled={downloading || cached}
        aria-label={cached ? `${filename} is available offline` : `Download ${filename} for offline use`}
        title={cached ? "Available offline" : "Download for offline use"}
        className={`shrink-0 rounded-md p-1.5 ${cached ? "text-success" : "text-foreground/40 hover:text-foreground"}`}
      >
        <Download size={14} />
      </button>
    </span>
  );
}
