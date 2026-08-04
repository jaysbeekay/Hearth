"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  portfolioSchema,
  holdingSchema,
  tradeSchema,
  propertyValuationSchema,
  importedTradesSchema,
  MAX_IMPORTED_TRADES,
} from "@/lib/validation/wealth";
import {
  saveTradeDocument,
  deleteTradeDocument,
  deleteTradeDir,
} from "@/lib/storage";
import { fetchHistoricalPrice } from "@/lib/prices";
import { isModuleEnabled } from "@/lib/modules/enablement";
import { formDataToStringValues } from "@/lib/form-state";
import type { ActionState } from "@/lib/actions/auth";
import { parse } from "csv-parse/sync";
import { describeUploadRejection } from "@/lib/uploadValidation";

const PORTFOLIO_FIELDS = ["name", "description", "currency"];
const HOLDING_FIELDS = ["ticker", "name", "assetClass", "exchange"];
const TRADE_FIELDS = ["type", "date", "units", "pricePerUnit", "fees", "currency", "fxRate", "notes"];
const VALUATION_FIELDS = ["valuedAt", "value", "currency", "source", "notes"];

function firstIssueMessage(error: { issues: { message: string }[] }) {
  return error.issues[0]?.message ?? "Invalid input";
}

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in");
  if (!(await isModuleEnabled("WEALTH"))) throw new Error("Wealth module is disabled");
  if (session.user.role === "READONLY") throw new Error("Your account has read-only access.");
  return session.user;
}

// ── Portfolios ──────────────────────────────────────────────────────────────

export async function createPortfolio(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const parsed = portfolioSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
    currency: formData.get("currency") || "AUD",
  });
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, PORTFOLIO_FIELDS),
    };
  }
  const portfolio = await prisma.portfolio.create({
    data: { ...parsed.data, createdById: user.id },
  });
  revalidatePath("/wealth");
  redirect(`/wealth/portfolios/${portfolio.id}`);
}

export async function updatePortfolio(
  portfolioId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();
  const parsed = portfolioSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
    currency: formData.get("currency") || "AUD",
  });
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, PORTFOLIO_FIELDS),
    };
  }
  const existing = await prisma.portfolio.findUnique({ where: { id: portfolioId } });
  if (!existing) return { error: "Portfolio not found." };

  await prisma.portfolio.update({ where: { id: portfolioId }, data: parsed.data });
  revalidatePath("/wealth");
  revalidatePath(`/wealth/portfolios/${portfolioId}`);
  redirect(`/wealth/portfolios/${portfolioId}`);
}

export async function deletePortfolio(portfolioId: string): Promise<ActionState> {
  await requireUser();
  const existing = await prisma.portfolio.findUnique({ where: { id: portfolioId } });
  if (!existing) return { error: "Portfolio not found." };

  await prisma.portfolio.delete({ where: { id: portfolioId } });
  revalidatePath("/wealth");
  redirect("/wealth");
}

// ── Holdings ────────────────────────────────────────────────────────────────

export async function createHolding(
  portfolioId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();
  const parsed = holdingSchema.safeParse({
    ticker: formData.get("ticker"),
    name: formData.get("name"),
    assetClass: formData.get("assetClass") || "SHARE",
    exchange: formData.get("exchange"),
  });
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, HOLDING_FIELDS),
    };
  }

  const portfolio = await prisma.portfolio.findUnique({ where: { id: portfolioId } });
  if (!portfolio) return { error: "Portfolio not found." };

  const existing = await prisma.holding.findUnique({
    where: { portfolioId_ticker: { portfolioId, ticker: parsed.data.ticker } },
  });
  if (existing) return { error: `${parsed.data.ticker} is already in this portfolio.` };

  const holding = await prisma.holding.create({
    data: { ...parsed.data, portfolioId },
  });
  revalidatePath(`/wealth/portfolios/${portfolioId}`);
  redirect(`/wealth/portfolios/${portfolioId}/holdings/${holding.id}`);
}

export async function updateHolding(
  portfolioId: string,
  holdingId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();
  const parsed = holdingSchema.safeParse({
    ticker: formData.get("ticker"),
    name: formData.get("name"),
    assetClass: formData.get("assetClass") || "SHARE",
    exchange: formData.get("exchange"),
  });
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, HOLDING_FIELDS),
    };
  }

  const holding = await prisma.holding.findUnique({ where: { id: holdingId } });
  if (!holding) return { error: "Holding not found." };

  await prisma.holding.update({ where: { id: holdingId }, data: parsed.data });
  revalidatePath(`/wealth/portfolios/${portfolioId}/holdings/${holdingId}`);
  redirect(`/wealth/portfolios/${portfolioId}/holdings/${holdingId}`);
}

export async function deleteHolding(portfolioId: string, holdingId: string): Promise<ActionState> {
  await requireUser();
  const holding = await prisma.holding.findUnique({ where: { id: holdingId } });
  if (!holding) return { error: "Holding not found." };

  await prisma.holding.delete({ where: { id: holdingId } });
  revalidatePath(`/wealth/portfolios/${portfolioId}`);
  redirect(`/wealth/portfolios/${portfolioId}`);
}

// ── Trades ──────────────────────────────────────────────────────────────────

async function requireHolding(holdingId: string) {
  return prisma.holding.findUnique({ where: { id: holdingId } });
}

async function attachTradeDocument(tradeId: string, file: File): Promise<ActionState | null> {
  const rejection = await describeUploadRejection(file);
  if (rejection) return { error: rejection };
  const { storedName, size, sha256, mimeType } = await saveTradeDocument(tradeId, file);
  await prisma.tradeDocument.create({
    data: {
      tradeId,
      filename: file.name.slice(0, 255),
      storedName,
      mimeType,
      size,
      sha256,
    },
  });
  return null;
}

export async function createTrade(
  holdingId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();
  const holding = await requireHolding(holdingId);
  if (!holding) return { error: "Holding not found." };

  const parsed = tradeSchema.safeParse({
    type: formData.get("type"),
    date: formData.get("date"),
    units: formData.get("units"),
    pricePerUnit: formData.get("pricePerUnit"),
    fees: formData.get("fees"),
    currency: formData.get("currency") || "AUD",
    fxRate: formData.get("fxRate"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, TRADE_FIELDS),
    };
  }

  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    const rejection = await describeUploadRejection(file);
    if (rejection) return { error: rejection };
  }

  const trade = await prisma.trade.create({ data: { ...parsed.data, holdingId } });

  if (file instanceof File && file.size > 0) {
    await attachTradeDocument(trade.id, file);
  }

  // Back-fill market price on trade date (non-blocking — don't fail the trade if fetch errors)
  if (holding.exchange !== "CRYPTO") {
    fetchHistoricalPrice(holding.ticker, parsed.data.date)
      .then((marketPrice) => {
        if (marketPrice != null) {
          return prisma.trade.update({ where: { id: trade.id }, data: { marketPriceOnDate: marketPrice } });
        }
      })
      .catch(() => {});
  }

  revalidatePath(`/wealth/portfolios/${holding.portfolioId}/holdings/${holdingId}`);
  redirect(`/wealth/portfolios/${holding.portfolioId}/holdings/${holdingId}`);
}

export async function updateTrade(
  holdingId: string,
  tradeId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();
  const holding = await requireHolding(holdingId);
  if (!holding) return { error: "Holding not found." };

  const trade = await prisma.trade.findUnique({ where: { id: tradeId } });
  if (!trade || trade.holdingId !== holdingId) return { error: "Trade not found." };

  const parsed = tradeSchema.safeParse({
    type: formData.get("type"),
    date: formData.get("date"),
    units: formData.get("units"),
    pricePerUnit: formData.get("pricePerUnit"),
    fees: formData.get("fees"),
    currency: formData.get("currency") || "AUD",
    fxRate: formData.get("fxRate"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, TRADE_FIELDS),
    };
  }

  await prisma.trade.update({ where: { id: tradeId }, data: parsed.data });
  revalidatePath(`/wealth/portfolios/${holding.portfolioId}/holdings/${holdingId}`);
  redirect(`/wealth/portfolios/${holding.portfolioId}/holdings/${holdingId}`);
}

export async function deleteTrade(holdingId: string, tradeId: string): Promise<ActionState> {
  await requireUser();
  const holding = await requireHolding(holdingId);
  if (!holding) return { error: "Holding not found." };

  const trade = await prisma.trade.findUnique({ where: { id: tradeId } });
  if (!trade || trade.holdingId !== holdingId) return { error: "Trade not found." };

  await deleteTradeDir(tradeId);
  await prisma.trade.delete({ where: { id: tradeId } });
  revalidatePath(`/wealth/portfolios/${holding.portfolioId}/holdings/${holdingId}`);
  return { success: "Trade deleted." };
}

export async function addTradeDocument(
  holdingId: string,
  tradeId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();
  const holding = await requireHolding(holdingId);
  if (!holding) return { error: "Holding not found." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload." };

  const trade = await prisma.trade.findUnique({ where: { id: tradeId } });
  if (!trade || trade.holdingId !== holdingId) return { error: "Trade not found." };

  const error = await attachTradeDocument(tradeId, file);
  if (error) return error;

  revalidatePath(`/wealth/portfolios/${holding.portfolioId}/holdings/${holdingId}`);
  return { success: "Document uploaded." };
}

export async function deleteTradeDocumentAction(
  holdingId: string,
  tradeId: string,
  documentId: string,
): Promise<ActionState> {
  await requireUser();
  const holding = await requireHolding(holdingId);
  if (!holding) return { error: "Holding not found." };

  const doc = await prisma.tradeDocument.findUnique({ where: { id: documentId } });
  if (!doc || doc.tradeId !== tradeId) return { error: "Document not found." };

  await prisma.tradeDocument.delete({ where: { id: documentId } });
  await deleteTradeDocument(tradeId, doc.storedName);

  revalidatePath(`/wealth/portfolios/${holding.portfolioId}/holdings/${holdingId}`);
  return { success: "Document removed." };
}

// ── CSV Import ───────────────────────────────────────────────────────────────

type ParsedTrade = {
  ticker: string;
  type: string;
  date: string;
  units: number;
  pricePerUnit: number;
  fees: number;
  currency: string;
  error?: string;
};

function detectFormat(headers: string[]): "commsec" | "selfwealth" | "stake" | "generic" {
  const h = headers.map((s) => s.toLowerCase().trim());
  if (h.includes("trade date") && h.includes("settlement date")) return "commsec";
  if (h.includes("transaction date") && h.includes("market")) return "selfwealth";
  if (h.includes("order_type")) return "stake";
  return "generic";
}

export async function parseTradesCsv(
  portfolioId: string,
  formData: FormData,
): Promise<{ rows: ParsedTrade[]; error?: string }> {
  await requireUser();
  const portfolio = await prisma.portfolio.findUnique({ where: { id: portfolioId } });
  if (!portfolio) return { rows: [], error: "Portfolio not found." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { rows: [], error: "Choose a CSV file." };
  if (!file.name.toLowerCase().endsWith(".csv")) return { rows: [], error: "Only CSV files are supported." };

  const text = await file.text();
  let records: Record<string, string>[];
  try {
    records = parse(text, { columns: true, skip_empty_lines: true, trim: true });
  } catch {
    return { rows: [], error: "Could not parse CSV — check the file format." };
  }

  if (!records.length) return { rows: [], error: "CSV is empty." };
  if (records.length > MAX_IMPORTED_TRADES) {
    return {
      rows: [],
      error: `That file has ${records.length} rows — import at most ${MAX_IMPORTED_TRADES} at a time.`,
    };
  }
  const headers = Object.keys(records[0]);
  const format = detectFormat(headers);

  const rows: ParsedTrade[] = records.flatMap((row): ParsedTrade[] => {
    try {
      if (format === "commsec") {
        const type = (row["Type"] ?? "").toUpperCase();
        const tradeType = type === "B" || type === "BUY" ? "BUY" : type === "S" || type === "SELL" ? "SELL" : null;
        if (!tradeType) return [];
        return [{
          ticker: (row["Symbol"] ?? "").trim().toUpperCase() + ".AX",
          type: tradeType,
          date: row["Trade Date"] ?? "",
          units: parseFloat(row["Quantity"] ?? "0"),
          pricePerUnit: parseFloat((row["Price ($)"] ?? "0").replace(/[^0-9.]/g, "")),
          fees: parseFloat((row["Brokerage ($)"] ?? "0").replace(/[^0-9.]/g, "")),
          currency: "AUD",
        }];
      }

      if (format === "selfwealth") {
        const type = (row["Transaction Type"] ?? row["Type"] ?? "").toUpperCase();
        const tradeType = type.includes("BUY") ? "BUY" : type.includes("SELL") ? "SELL" : null;
        if (!tradeType) return [];
        const market = (row["Market"] ?? "ASX").toUpperCase();
        const suffix = market === "ASX" ? ".AX" : "";
        return [{
          ticker: (row["Code"] ?? "").trim().toUpperCase() + suffix,
          type: tradeType,
          date: row["Transaction Date"] ?? "",
          units: parseFloat(row["Quantity"] ?? "0"),
          pricePerUnit: parseFloat((row["Price"] ?? "0").replace(/[^0-9.]/g, "")),
          fees: parseFloat((row["Brokerage"] ?? "0").replace(/[^0-9.]/g, "")),
          currency: "AUD",
        }];
      }

      if (format === "stake") {
        const type = (row["order_type"] ?? "").toUpperCase();
        const tradeType = type === "BUY" ? "BUY" : type === "SELL" ? "SELL" : null;
        if (!tradeType) return [];
        return [{
          ticker: (row["symbol"] ?? "").trim().toUpperCase(),
          type: tradeType,
          date: row["created_at"] ?? "",
          units: parseFloat(row["quantity"] ?? "0"),
          pricePerUnit: parseFloat(row["price"] ?? "0"),
          fees: parseFloat(row["commission"] ?? "0"),
          currency: "USD",
        }];
      }

      // generic — expect: Date, Ticker, Type, Units, Price, Fees, Currency
      const tradeType = (row["Type"] ?? "").toUpperCase();
      if (!["BUY", "SELL", "DIVIDEND"].includes(tradeType)) return [];
      return [{
        ticker: (row["Ticker"] ?? "").trim().toUpperCase(),
        type: tradeType,
        date: row["Date"] ?? "",
        units: parseFloat(row["Units"] ?? "0"),
        pricePerUnit: parseFloat(row["Price"] ?? "0"),
        fees: parseFloat(row["Fees"] ?? "0"),
        currency: (row["Currency"] ?? "AUD").toUpperCase(),
      }];
    } catch {
      return [];
    }
  });

  return { rows: rows.filter((r) => r.ticker && r.units > 0) };
}

export async function importTrades(
  portfolioId: string,
  rows: ParsedTrade[],
): Promise<ActionState> {
  await requireUser();
  const portfolio = await prisma.portfolio.findUnique({ where: { id: portfolioId } });
  if (!portfolio) return { error: "Portfolio not found." };

  // `rows` arrives from the client. The ParsedTrade[] type is compile-time
  // only, so validate it for real before any of it reaches the database.
  const validated = importedTradesSchema.safeParse(rows);
  if (!validated.success) {
    return { error: firstIssueMessage(validated.error) };
  }

  let imported = 0;
  let skipped = 0;

  for (const row of validated.data) {
    const date = new Date(row.date);
    if (isNaN(date.getTime())) { skipped++; continue; }

    const holding = await prisma.holding.upsert({
      where: { portfolioId_ticker: { portfolioId, ticker: row.ticker } },
      create: { portfolioId, ticker: row.ticker, assetClass: "SHARE" },
      update: {},
    });

    // Duplicate check: same holding, date, type, units, price
    const existing = await prisma.trade.findFirst({
      where: {
        holdingId: holding.id,
        date,
        type: row.type,
        units: row.units,
        pricePerUnit: row.pricePerUnit,
      },
    });
    if (existing) { skipped++; continue; }

    const newTrade = await prisma.trade.create({
      data: {
        holdingId: holding.id,
        type: row.type,
        date,
        units: row.units,
        pricePerUnit: row.pricePerUnit,
        fees: row.fees || null,
        currency: row.currency,
      },
    });

    // Fetch market price for this trade date (non-blocking)
    if (row.currency !== "CRYPTO") {
      fetchHistoricalPrice(row.ticker, date)
        .then((marketPrice) => {
          if (marketPrice != null) {
            return prisma.trade.update({ where: { id: newTrade.id }, data: { marketPriceOnDate: marketPrice } });
          }
        })
        .catch(() => {});
    }

    imported++;
  }

  revalidatePath(`/wealth/portfolios/${portfolioId}`);
  revalidatePath("/wealth");
  return { success: `Imported ${imported} trade${imported !== 1 ? "s" : ""}${skipped ? `, skipped ${skipped} duplicate${skipped !== 1 ? "s" : ""}` : ""}.` };
}

// ── Property Valuations ─────────────────────────────────────────────────────

async function requireHomeEnabled() {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in");
  if (session.user.role === "READONLY") throw new Error("Your account has read-only access.");
  return session.user;
}

export async function createPropertyValuation(
  propertyId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireHomeEnabled();
  const parsed = propertyValuationSchema.safeParse({
    valuedAt: formData.get("valuedAt"),
    value: formData.get("value"),
    currency: formData.get("currency") || "AUD",
    source: formData.get("source"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, VALUATION_FIELDS),
    };
  }

  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) return { error: "Property not found." };

  await prisma.propertyValuation.create({ data: { ...parsed.data, propertyId } });
  revalidatePath(`/home/${propertyId}`);
  return { success: "Valuation saved." };
}

export async function deletePropertyValuation(
  propertyId: string,
  valuationId: string,
): Promise<ActionState> {
  await requireHomeEnabled();
  const valuation = await prisma.propertyValuation.findUnique({ where: { id: valuationId } });
  if (!valuation || valuation.propertyId !== propertyId) return { error: "Valuation not found." };

  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) return { error: "Property not found." };

  await prisma.propertyValuation.delete({ where: { id: valuationId } });
  revalidatePath(`/home/${propertyId}`);
  return { success: "Valuation removed." };
}

export async function addPropertyValuation(
  propertyId: string,
  formData: FormData,
): Promise<void> {
  await createPropertyValuation(propertyId, null, formData);
}
