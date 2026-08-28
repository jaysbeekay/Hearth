import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readHomeItemDocument } from "@/lib/storage";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const doc = await prisma.homeItemDocument.findUnique({
    where: { id },
    include: { homeItem: { select: { deletedAt: true } } },
  });
  if (!doc || doc.deletedAt || doc.homeItem.deletedAt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const buffer = await readHomeItemDocument(doc.homeItemId, doc.storedName);
  const safeFilename = doc.filename.replace(/[\r\n"]/g, "_");

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": `attachment; filename="${safeFilename}"`,
      "Content-Length": String(doc.size),
    },
  });
}
