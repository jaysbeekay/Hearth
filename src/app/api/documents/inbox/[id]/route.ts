import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { contentDisposition, INLINE_PARAM } from "@/lib/documents/inlineView";
import { prisma } from "@/lib/prisma";
import { readInboxDocument } from "@/lib/storage";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const doc = await prisma.inboxDocument.findUnique({ where: { id } });
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const buffer = await readInboxDocument(doc.storedName);
  const inline = request.nextUrl.searchParams.get(INLINE_PARAM) === "1";

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": contentDisposition(doc.mimeType, doc.filename, inline),
      "Content-Length": String(doc.size),
    },
  });
}
