import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import PDFDocument from "pdfkit";
import { stringify } from "csv-stringify/sync";
import { formatDate, formatCurrency, VEHICLE_ITEM_TYPE_LABELS } from "@/lib/utils";
import { isModuleEnabled } from "@/lib/modules/enablement";
import { getUserPreferences } from "@/lib/userPreferences";
import { sanitizeCsvRow } from "@/lib/csvSafety";
import { COVERING_CONTRACTS, withVehicleCovers } from "@/lib/covers";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });
  if (!(await isModuleEnabled("VEHICLES"))) return new NextResponse("Vehicles module disabled", { status: 403 });

  const format = request.nextUrl.searchParams.get("format") ?? "csv";

  const [vehicles, { dateFormat, region }] = await Promise.all([
    prisma.vehicle.findMany({
      where: { deletedAt: null },
      include: { items: { orderBy: { date: "desc" } }, contracts: COVERING_CONTRACTS },
    }),
    getUserPreferences(),
  ]);

  const allItems = vehicles.flatMap((v) =>
    v.items.map((item) => ({ ...item, vehicleLabel: v.label, vehicle: v, effective: withVehicleCovers(v) })),
  );

  if (format === "pdf") {
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const stream = new ReadableStream<Uint8Array>({ start(controller) { doc.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk))); doc.on("end", () => controller.close()); doc.on("error", (error) => controller.error(error)); } });

    doc.fontSize(18).text("Service Records Export", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor("#666").text(`Generated ${new Date().toLocaleDateString("en-AU")}`, { align: "center" });
    doc.moveDown();

    for (const item of allItems) {
      doc.fontSize(11).fillColor("#000").text(item.title);
      doc.fontSize(9).fillColor("#444")
        .text(`Vehicle: ${item.vehicleLabel}   Type: ${VEHICLE_ITEM_TYPE_LABELS[item.type] ?? item.type}`)
        .text(`Provider: ${item.provider ?? "—"}   Date: ${formatDate(item.date, dateFormat)}`)
        .text(`Cost: ${formatCurrency(item.cost, item.currency, undefined, region)}`);
      doc.moveDown(0.5);
    }

    doc.end();
    return new NextResponse(stream, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=\"vehicle-records.pdf\"",
      },
    });
  }

  const rows = allItems.map((item) => [
    item.vehicleLabel,
    VEHICLE_ITEM_TYPE_LABELS[item.type] ?? item.type,
    item.title,
    item.provider ?? "",
    formatDate(item.date, dateFormat),
    item.cost ?? "",
    item.currency,
    // A Covering Contract's end date is the effective date; the Vehicle's own stays beside it (#456).
    item.effective.regoExpiry ? formatDate(item.effective.regoExpiry, dateFormat) : "",
    item.vehicle.regoExpiry ? formatDate(item.vehicle.regoExpiry, dateFormat) : "",
    item.effective.insuranceExpiry ? formatDate(item.effective.insuranceExpiry, dateFormat) : "",
    item.vehicle.insuranceExpiry ? formatDate(item.vehicle.insuranceExpiry, dateFormat) : "",
  ]);

  const csv = stringify([
    ["Vehicle", "Type", "Title", "Provider", "Date", "Cost", "Currency", "Rego expiry", "Rego expiry (own date)", "Insurance expiry", "Insurance expiry (own date)"],
    ...rows.map(sanitizeCsvRow),
  ]);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"vehicle-records.csv\"",
    },
  });
}
