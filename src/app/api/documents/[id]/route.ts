import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { documentStoreFor } from "@/lib/storage";
import { findServableDocument } from "@/lib/documents/shareLinks";
import { contentDisposition, INLINE_PARAM } from "@/lib/documents/inlineView";

// #396 — the one file route for a Document of every kind. The id alone
// finds it (cuids are unique across the 8 tables). Household-wide like the
// rest of the app: any signed-in member can read it, as long as the kind's
// module is on and neither the Document nor its record is in Trash. Each of
// those cases is a 404, so a disabled module doesn't reveal what exists.
// The old per-module routes redirect here. Inbox files keep their own
// route (/api/documents/inbox/[id]).

type Params = { params: Promise<{ id: string }> };

/** The Document and its headers, or the 401/404 to send instead. GET and HEAD share it. */
async function resolve(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  }

  const { id } = await params;
  const doc = await findServableDocument(id);
  if (!doc) return { ok: false, response: NextResponse.json({ error: "Not found" }, { status: 404 }) } as const;

  const inline = request.nextUrl.searchParams.get(INLINE_PARAM) === "1";
  const headers = {
    "Content-Type": doc.mimeType,
    "Content-Disposition": contentDisposition(doc.mimeType, doc.filename, inline),
    "Content-Length": String(doc.size),
  };
  return { ok: true, doc, headers } as const;
}

export async function GET(request: NextRequest, context: Params) {
  const found = await resolve(request, context);
  if (!found.ok) return found.response;
  const { doc, headers } = found;
  const buffer = await documentStoreFor(doc.kind).read(doc.ownerId, doc.storedName);
  return new NextResponse(buffer, { headers });
}

// The preview asks with HEAD before it frames the file (DocumentPreviewModal).
// Without this, Next answers HEAD by running GET, reading the whole file.
export async function HEAD(request: NextRequest, context: Params) {
  const found = await resolve(request, context);
  if (!found.ok) return new NextResponse(null, { status: found.response.status });
  return new NextResponse(null, { headers: found.headers });
}
