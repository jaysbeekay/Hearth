import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { contentDisposition, INLINE_PARAM } from "@/lib/documents/inlineView";
import { prisma } from "@/lib/prisma";
import { readInboxDocument } from "@/lib/storage";

type Params = { params: Promise<{ id: string }> };

/** The Inbox file and its headers, or the 401/404 to send instead. GET and HEAD share it. */
async function resolve(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  }

  const { id } = await params;
  const doc = await prisma.inboxDocument.findUnique({ where: { id } });
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
  const buffer = await readInboxDocument(found.doc.storedName);
  return new NextResponse(buffer, { headers: found.headers });
}

// The preview asks with HEAD before it frames the file (DocumentPreviewModal).
// Without this, Next answers HEAD by running GET, reading the whole file.
export async function HEAD(request: NextRequest, context: Params) {
  const found = await resolve(request, context);
  if (!found.ok) return new NextResponse(null, { status: found.response.status });
  return new NextResponse(null, { headers: found.headers });
}
