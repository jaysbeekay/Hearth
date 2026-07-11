import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import PDFDocument from "pdfkit";
import { stringify } from "csv-stringify/sync";
import { formatDate, formatCurrency, CATEGORY_LABELS, BILLING_LABELS } from "@/lib/utils";
import { getUserPreferences } from "@/lib/userPreferences";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const format = request.nextUrl.searchParams.get("format") ?? "csv";

  const [contracts, { dateFormat }] = await Promise.all([
    prisma.contract.findMany({
      where: { createdById: session.user.id },
      orderBy: { endDate: "asc" },
    }),
    getUserPreferences(),
  ]);

  if (format === "pdf") {
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));

    doc.fontSize(18).text("Contracts Export", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor("#666").text(`Generated ${new Date().toLocaleDateString("en-AU")}`, { align: "center" });
    doc.moveDown();

    for (const c of contracts) {
      doc.fontSize(11).fillColor("#000").text(c.title, { continued: false });
      doc.fontSize(9).fillColor("#444")
        .text(`Provider: ${c.provider}   Category: ${CATEGORY_LABELS[c.category] ?? c.category}`)
        .text(`Period: ${formatDate(c.startDate, dateFormat)} – ${formatDate(c.endDate, dateFormat)}`)
        .text(`Cost: ${formatCurrency(c.cost, c.currency)}${c.billingFrequency ? ` (${BILLING_LABELS[c.billingFrequency] ?? c.billingFrequency})` : ""}`)
        .text(`Tax deductible: ${c.isTaxDeductible ? "Yes" : "No"}`);
      doc.moveDown(0.5);
    }

    doc.end();
    await new Promise((resolve) => doc.on("end", resolve));
    const pdf = Buffer.concat(chunks);

    return new NextResponse(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=\"contracts.pdf\"",
      },
    });
  }

  // CSV
  const rows = contracts.map((c) => [
    c.title,
    c.provider,
    CATEGORY_LABELS[c.category] ?? c.category,
    formatDate(c.startDate, dateFormat),
    formatDate(c.endDate, dateFormat),
    c.cost ?? "",
    c.billingFrequency ? (BILLING_LABELS[c.billingFrequency] ?? c.billingFrequency) : "",
    c.currency,
    c.isTaxDeductible ? "Yes" : "No",
    c.status,
  ]);

  const csv = stringify([
    ["Title", "Provider", "Category", "Start Date", "End Date", "Cost", "Billing Frequency", "Currency", "Tax Deductible", "Status"],
    ...rows,
  ]);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"contracts.csv\"",
    },
  });
}
