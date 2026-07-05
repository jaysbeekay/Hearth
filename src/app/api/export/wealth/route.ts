import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { stringify } from "csv-stringify/sync";
import { isModuleEnabled } from "@/lib/modules/enablement";
import { formatDate } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });
  if (!(await isModuleEnabled("WEALTH"))) return new NextResponse("Module disabled", { status: 403 });

  const format = request.nextUrl.searchParams.get("format") ?? "csv";

  const portfolios = await prisma.portfolio.findMany({
    where: { createdById: session.user.id },
    include: {
      holdings: {
        include: { trades: { orderBy: { date: "asc" } } },
      },
    },
    orderBy: { name: "asc" },
  });

  const rows: (string | number)[][] = [];
  for (const portfolio of portfolios) {
    for (const holding of portfolio.holdings) {
      for (const trade of holding.trades) {
        rows.push([
          portfolio.name,
          holding.ticker,
          holding.name ?? "",
          holding.assetClass,
          trade.type,
          formatDate(trade.date),
          trade.units,
          trade.pricePerUnit,
          trade.fees ?? "",
          trade.currency,
          trade.fxRate ?? "",
          trade.notes ?? "",
        ]);
      }
    }
  }

  if (format === "pdf") {
    const PDFDocument = (await import("pdfkit")).default;
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));

    doc.fontSize(18).text("Portfolio Trade History", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor("#666").text(`Generated ${new Date().toLocaleDateString("en-AU")}`, { align: "center" });
    doc.moveDown();

    for (const portfolio of portfolios) {
      doc.fontSize(12).fillColor("#000").text(portfolio.name);
      for (const holding of portfolio.holdings) {
        doc.fontSize(10).fillColor("#333").text(`  ${holding.ticker}${holding.name ? ` — ${holding.name}` : ""}`);
        for (const trade of holding.trades) {
          doc.fontSize(8).fillColor("#555")
            .text(`    ${trade.type}  ${formatDate(trade.date)}  ${trade.units} @ ${trade.pricePerUnit} ${trade.currency}${trade.fees ? `  fees: ${trade.fees}` : ""}`);
        }
      }
      doc.moveDown(0.5);
    }

    doc.end();
    await new Promise((resolve) => doc.on("end", resolve));
    const pdf = Buffer.concat(chunks);

    return new NextResponse(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=\"portfolio-trades.pdf\"",
      },
    });
  }

  const csv = stringify([
    ["Portfolio", "Ticker", "Name", "Asset Class", "Trade Type", "Date", "Units", "Price/Unit", "Fees", "Currency", "FX Rate", "Notes"],
    ...rows,
  ]);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"portfolio-trades.csv\"",
    },
  });
}
