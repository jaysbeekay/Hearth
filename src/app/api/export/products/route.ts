import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import PDFDocument from "pdfkit";
import { stringify } from "csv-stringify/sync";
import { formatDate, formatCurrency } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const format = request.nextUrl.searchParams.get("format") ?? "csv";

  const products = await prisma.product.findMany({
    where: { createdById: session.user.id },
    orderBy: { warrantyEndDate: "asc" },
  });

  if (format === "pdf") {
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));

    doc.fontSize(18).text("Products & Warranties Export", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor("#666").text(`Generated ${new Date().toLocaleDateString("en-AU")}`, { align: "center" });
    doc.moveDown();

    for (const p of products) {
      doc.fontSize(11).fillColor("#000").text(p.name);
      doc.fontSize(9).fillColor("#444")
        .text(`Manufacturer: ${p.manufacturer ?? "—"}   Vendor: ${p.vendor ?? "—"}`)
        .text(`Purchased: ${formatDate(p.purchaseDate)}   Warranty ends: ${formatDate(p.warrantyEndDate)}`)
        .text(`Price: ${formatCurrency(p.price, p.currency)}`);
      if (p.serialNumber) doc.text(`Serial: ${p.serialNumber}`);
      doc.moveDown(0.5);
    }

    doc.end();
    await new Promise((resolve) => doc.on("end", resolve));
    const pdf = Buffer.concat(chunks);

    return new NextResponse(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=\"products.pdf\"",
      },
    });
  }

  const rows = products.map((p) => [
    p.name,
    p.manufacturer ?? "",
    p.vendor ?? "",
    formatDate(p.purchaseDate),
    formatDate(p.warrantyEndDate),
    p.price ?? "",
    p.currency,
    p.serialNumber ?? "",
  ]);

  const csv = stringify([
    ["Name", "Manufacturer", "Vendor", "Purchase Date", "Warranty End", "Price", "Currency", "Serial Number"],
    ...rows,
  ]);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"products.csv\"",
    },
  });
}
