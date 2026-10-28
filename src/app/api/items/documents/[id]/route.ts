import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readItemDocument } from "@/lib/storage";
import { itemCutoverReadiness } from "@/lib/items/cutoverReadiness";

// Staged Item Documents use their own route until the shared Document command
// and /api/documents/[id] switch from Product/InventoryItem to Item.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.ITEMS_PREVIEW !== "1" || !(await itemCutoverReadiness()).ready) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { id } = await params;
  const doc = await prisma.itemDocument.findUnique({ where: { id }, include: { item: true } });
  if (!doc || doc.deletedAt || doc.item.deletedAt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const buffer = await readItemDocument(doc.itemId, doc.storedName);
  const safeFilename = doc.filename.replace(/[\r\n"]/g, "_");
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": `attachment; filename="${safeFilename}"`,
      "Content-Length": String(doc.size),
    },
  });
}
