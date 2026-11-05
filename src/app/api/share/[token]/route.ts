import { NextRequest, NextResponse } from "next/server";
import { documentStoreFor } from "@/lib/storage";
import { openShareLink } from "@/lib/documents/shareLinks";

// #374 — a shared Document, opened by its link's token instead of a session
// (a public path in auth.config.ts). Unknown, expired and revoked links, and
// links whose Document has gone to Trash or whose file can't be read, are
// all the same 404.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const opened = await openShareLink(token, (doc) => documentStoreFor(doc.kind).read(doc.ownerId, doc.storedName));
  if (!opened) {
    return new NextResponse("This link has expired or been revoked.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const { doc, buffer } = opened;
  const safeFilename = doc.filename.replace(/[\r\n"]/g, "_");
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": doc.mimeType,
      // Always a download, never rendered on this origin.
      "Content-Disposition": `attachment; filename="${safeFilename}"`,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  });
}
