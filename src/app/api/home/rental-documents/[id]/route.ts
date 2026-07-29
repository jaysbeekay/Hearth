import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readRentalStatementDocument } from "@/lib/storage";
import { isModuleEnabled } from "@/lib/modules/enablement";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isModuleEnabled("HOME"))) {
    return NextResponse.json({ error: "Property module is disabled." }, { status: 403 });
  }

  const { id } = await params;
  const doc = await prisma.rentalStatementDocument.findUnique({ where: { id } });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const buffer = await readRentalStatementDocument(doc.rentalStatementId, doc.storedName);
  const safeFilename = doc.filename.replace(/[^\w.\-]/g, "_");

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": `attachment; filename="${safeFilename}"`,
    },
  });
}
