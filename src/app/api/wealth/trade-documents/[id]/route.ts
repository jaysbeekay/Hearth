import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readTradeDocument } from "@/lib/storage";
import { isModuleEnabled } from "@/lib/modules/enablement";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isModuleEnabled("WEALTH"))) {
    return NextResponse.json({ error: "Module disabled" }, { status: 403 });
  }

  const { id } = await params;
  const doc = await prisma.tradeDocument.findUnique({
    where: { id },
    include: { trade: { include: { holding: { include: { portfolio: true } } } } },
  });
  if (!doc || doc.trade.holding.portfolio.createdById !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const buffer = await readTradeDocument(doc.tradeId, doc.storedName);
  const safeFilename = doc.filename.replace(/[\r\n"]/g, "_");

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": `attachment; filename="${safeFilename}"`,
      "Content-Length": String(doc.size),
    },
  });
}
