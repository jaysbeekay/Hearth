import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import PDFDocument from "pdfkit";
import { stringify } from "csv-stringify/sync";
import { formatDate, formatCurrency, HOME_ITEM_TYPE_LABELS } from "@/lib/utils";
import { isModuleEnabled } from "@/lib/modules/enablement";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });
  if (!(await isModuleEnabled("HOME"))) return new NextResponse("Home module disabled", { status: 403 });

  const format = request.nextUrl.searchParams.get("format") ?? "csv";

  const properties = await prisma.property.findMany({
    where: { createdById: session.user.id },
    include: { items: { orderBy: { date: "desc" } } },
  });

  const allItems = properties.flatMap((p) =>
    p.items.map((item) => ({ ...item, propertyLabel: p.label })),
  );

  if (format === "pdf") {
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));

    doc.fontSize(18).text("Home Items Export", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor("#666").text(`Generated ${new Date().toLocaleDateString("en-AU")}`, { align: "center" });
    doc.moveDown();

    for (const item of allItems) {
      doc.fontSize(11).fillColor("#000").text(item.title);
      doc.fontSize(9).fillColor("#444")
        .text(`Property: ${item.propertyLabel}   Type: ${HOME_ITEM_TYPE_LABELS[item.type] ?? item.type}`)
        .text(`Provider: ${item.provider ?? "—"}   Date: ${formatDate(item.date)}`)
        .text(`Cost: ${formatCurrency(item.cost, item.currency)}   Tax deductible: ${item.isTaxDeductible ? "Yes" : "No"}`);
      doc.moveDown(0.5);
    }

    doc.end();
    await new Promise((resolve) => doc.on("end", resolve));
    const pdf = Buffer.concat(chunks);

    return new NextResponse(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=\"home-items.pdf\"",
      },
    });
  }

  const rows = allItems.map((item) => [
    item.propertyLabel,
    HOME_ITEM_TYPE_LABELS[item.type] ?? item.type,
    item.title,
    item.provider ?? "",
    formatDate(item.date),
    item.cost ?? "",
    item.currency,
    item.isTaxDeductible ? "Yes" : "No",
  ]);

  const csv = stringify([
    ["Property", "Type", "Title", "Provider", "Date", "Cost", "Currency", "Tax Deductible"],
    ...rows,
  ]);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"home-items.csv\"",
    },
  });
}
