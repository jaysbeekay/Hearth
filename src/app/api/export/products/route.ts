import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import PDFDocument from "pdfkit";
import { stringify } from "csv-stringify/sync";
import { formatDate, formatCurrency } from "@/lib/utils";
import { getUserPreferences } from "@/lib/userPreferences";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const format = request.nextUrl.searchParams.get("format") ?? "csv";

  const [products, { dateFormat, region }] = await Promise.all([
    prisma.product.findMany({
      orderBy: { warrantyEndDate: "asc" },
    }),
    getUserPreferences(),
  ]);

  if (format === "pdf") {
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        doc.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
        doc.on("end", () => controller.close());
        doc.on("error", (error) => controller.error(error));
      },
    });

    doc.fontSize(18).text("Products & Warranties Export", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor("#666").text(`Generated ${new Date().toLocaleDateString("en-AU")}`, { align: "center" });
    doc.moveDown();

    for (const p of products) {
      doc.fontSize(11).fillColor("#000").text(p.description);
      doc.fontSize(9).fillColor("#444")
        .text(`Brand: ${p.manufacturer ?? "—"}   Model: ${p.model ?? "—"}   Vendor: ${p.vendor ?? "—"}`)
        .text(`Purchased: ${formatDate(p.purchaseDate, dateFormat)}   Warranty ends: ${formatDate(p.warrantyEndDate, dateFormat)}`)
        .text(`Price: ${formatCurrency(p.price, p.currency, undefined, region)}`);
      if (p.serialNumber) doc.text(`Serial: ${p.serialNumber}`);
      doc.moveDown(0.5);
    }

    doc.end();
    return new NextResponse(stream, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=\"products.pdf\"",
      },
    });
  }

  const rows = products.map((p) => [
    p.description,
    p.manufacturer ?? "",
    p.model ?? "",
    p.vendor ?? "",
    formatDate(p.purchaseDate, dateFormat),
    formatDate(p.warrantyEndDate, dateFormat),
    p.price ?? "",
    p.currency,
    p.serialNumber ?? "",
  ]);

  const csv = stringify([
    ["Description", "Brand", "Model", "Vendor", "Purchase Date", "Warranty End", "Price", "Currency", "Serial Number"],
    ...rows,
  ]);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"products.csv\"",
    },
  });
}
