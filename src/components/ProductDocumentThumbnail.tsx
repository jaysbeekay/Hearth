"use client";

import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { getOfflineDocument } from "@/lib/offlineDocuments";
import { useOnlineStatus } from "@/lib/useOnlineStatus";

// The plain <img src="/api/products/documents/{id}"> in ProductDocumentList
// makes its own network request outside DocumentLink's control, so it fails
// offline even for a document that's been downloaded for offline use — this
// swaps in the cached blob when offline instead.
export function ProductDocumentThumbnail({
  href,
  filename,
}: {
  href: string;
  filename: string;
}) {
  const online = useOnlineStatus();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    if (online) return;
    let url: string | null = null;
    getOfflineDocument(href).then((doc) => {
      if (doc) {
        url = URL.createObjectURL(doc.blob);
        setBlobUrl(url);
      }
    });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [online, href]);

  if (!online && !blobUrl) {
    return <FileText size={18} className="shrink-0 text-foreground/50" />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={online ? href : (blobUrl ?? href)}
      alt={filename}
      className="h-10 w-10 shrink-0 rounded-md object-cover"
    />
  );
}
