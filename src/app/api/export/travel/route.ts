import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import PDFDocument from "pdfkit";
import { stringify } from "csv-stringify/sync";
import { formatDate, TRIP_SEGMENT_TYPE_LABELS } from "@/lib/utils";
import { isModuleEnabled } from "@/lib/modules/enablement";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });
  if (!(await isModuleEnabled("TRAVEL"))) return new NextResponse("Travel module disabled", { status: 403 });

  const format = request.nextUrl.searchParams.get("format") ?? "csv";

  const trips = await prisma.trip.findMany({
    where: { createdById: session.user.id },
    include: { segments: { orderBy: { startDate: "asc" } } },
    orderBy: { startDate: "desc" },
  });

  const allSegments = trips.flatMap((t) =>
    t.segments.map((s) => ({ ...s, tripTitle: t.title })),
  );

  if (format === "pdf") {
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));

    doc.fontSize(18).text("Travel Export", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor("#666").text(`Generated ${new Date().toLocaleDateString("en-AU")}`, { align: "center" });
    doc.moveDown();

    for (const s of allSegments) {
      doc.fontSize(11).fillColor("#000").text(s.title);
      doc.fontSize(9).fillColor("#444")
        .text(`Trip: ${s.tripTitle}   Type: ${TRIP_SEGMENT_TYPE_LABELS[s.type] ?? s.type}`)
        .text(`${formatDate(s.startDate)} – ${formatDate(s.endDate)}`);
      if (s.provider) doc.text(`Provider: ${s.provider}`);
      doc.moveDown(0.5);
    }

    doc.end();
    await new Promise((resolve) => doc.on("end", resolve));
    const pdf = Buffer.concat(chunks);

    return new NextResponse(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=\"travel.pdf\"",
      },
    });
  }

  const rows = allSegments.map((s) => [
    s.tripTitle,
    TRIP_SEGMENT_TYPE_LABELS[s.type] ?? s.type,
    s.title,
    s.provider ?? "",
    formatDate(s.startDate),
    formatDate(s.endDate),
  ]);

  const csv = stringify([
    ["Trip", "Type", "Title", "Provider", "Start Date", "End Date"],
    ...rows,
  ]);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"travel.csv\"",
    },
  });
}
