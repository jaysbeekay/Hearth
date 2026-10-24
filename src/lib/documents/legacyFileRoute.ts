import type { NextRequest } from "next/server";
import { documentFileHref } from "@/lib/documents/kinds";

// #396 — the per-module file routes (/api/vehicles/documents/[id] etc.) are
// kept only so old links, bookmarks and offline copies still open the file.
// They redirect to the one route, which does the auth, module and Trash
// checks. The Location is relative, so it's right behind a reverse proxy
// whatever host the app thinks it has.
export async function redirectToDocumentFile(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return new Response(null, {
    status: 308,
    headers: { Location: documentFileHref(encodeURIComponent(id)) },
  });
}
