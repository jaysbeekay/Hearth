"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  formToPortfolioInput,
  formToHoldingInput,
  formToTradeInput,
  formToPropertyValuationInput,
} from "@/lib/formMappers";
import { prisma } from "@/lib/prisma";
import { fullFormUpdate } from "@/lib/validation/fullFormUpdate";
import {
  portfolioSchema,
  holdingSchema,
  tradeSchema,
  propertyValuationSchema,
  importedTradesSchema,
  MAX_IMPORTED_TRADES,
} from "@/lib/validation/wealth";
import { addDocumentCommand } from "@/lib/commands/documents";
import { isModuleEnabled, ModuleDisabledError } from "@/lib/modules/enablement";
import { createPropertyValuationCommand, deletePropertyValuationCommand } from "@/lib/commands/home";
import {
  createPortfolioCommand,
  updatePortfolioCommand,
  permanentlyDeletePortfolioCommand,
  createHoldingCommand,
  updateHoldingCommand,
  permanentlyDeleteHoldingCommand,
  createTradeCommand,
  updateTradeCommand,
  permanentlyDeleteTradeCommand,
  importTradesCommand,
  DuplicateHoldingError,
} from "@/lib/commands/wealth";
import { RecordNotFoundError, StaleEditError } from "@/lib/commands/shared";
import { formDataToStringValues } from "@/lib/form-state";
import type { ActionState } from "@/lib/actions/auth";
import { parse } from "csv-parse/sync";
import { describeUploadRejection } from "@/lib/uploadValidation";

const PORTFOLIO_FIELDS = ["name", "description", "currency", "costMethod"];
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

// Turns a command's not-found / stale-edit / module-disabled / duplicate-
// ticker error into the ActionState the form shows; anything else is
// unexpected and rethrown. (requireUser checks the Wealth module first, but
// the command's own gate can still refuse if it's switched off in between.)
function commandError(error: unknown, notFound: string): ActionState {
  if (error instanceof RecordNotFoundError) return { error: notFound };
  if (
    error instanceof StaleEditError ||
    error instanceof ModuleDisabledError ||
    error instanceof DuplicateHoldingError
  ) {
    return { error: error.message };
  }
  throw error;
}

// ── Portfolios ──────────────────────────────────────────────────────────────

export async function createPortfolio(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const parsed = portfolioSchema.safeParse(formToPortfolioInput(formData));
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, PORTFOLIO_FIELDS),
    };
  }
  let portfolioId: string;
  try {
    portfolioId = (await createPortfolioCommand(parsed.data, user.id)).id;
  } catch (error) {
    return commandError(error, "Portfolio not found.");
  }
  redirect(`/wealth/portfolios/${portfolioId}`);
}

export async function updatePortfolio(
  portfolioId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();
  const parsed = portfolioSchema.safeParse(formToPortfolioInput(formData));
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, PORTFOLIO_FIELDS),
    };
  }
  try {
    await updatePortfolioCommand(portfolioId, fullFormUpdate(portfolioSchema, parsed.data, formData));
  } catch (error) {
    return commandError(error, "Portfolio not found.");
  }
  redirect(`/wealth/portfolios/${portfolioId}`);
}

// Permanent: Portfolios have no Trash (see commands/wealth.ts).
export async function deletePortfolio(portfolioId: string): Promise<ActionState> {
  await requireUser();
  try {
    await permanentlyDeletePortfolioCommand(portfolioId);
  } catch (error) {
    return commandError(error, "Portfolio not found.");
  }
  redirect("/wealth");
}

// ── Holdings ────────────────────────────────────────────────────────────────

export async function createHolding(
  portfolioId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();
  const parsed = holdingSchema.safeParse(formToHoldingInput(formData));
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, HOLDING_FIELDS),
    };
  }
  let holdingId: string;
  try {
    holdingId = (await createHoldingCommand(portfolioId, parsed.data)).id;
  } catch (error) {
    return commandError(error, "Portfolio not found.");
  }
  redirect(`/wealth/portfolios/${portfolioId}/holdings/${holdingId}`);
}

export async function updateHolding(
  portfolioId: string,
  holdingId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();
  const parsed = holdingSchema.safeParse(formToHoldingInput(formData));
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, HOLDING_FIELDS),
    };
  }
  try {
    await updateHoldingCommand(holdingId, fullFormUpdate(holdingSchema, parsed.data, formData), { portfolioId });
  } catch (error) {
    return commandError(error, "Holding not found.");
  }
  redirect(`/wealth/portfolios/${portfolioId}/holdings/${holdingId}`);
}

// Permanent, with all its Trades (see commands/wealth.ts).
export async function deleteHolding(portfolioId: string, holdingId: string): Promise<ActionState> {
  await requireUser();
  try {
    await permanentlyDeleteHoldingCommand(holdingId, { portfolioId });
  } catch (error) {
    return commandError(error, "Holding not found.");
  }
  redirect(`/wealth/portfolios/${portfolioId}`);
}

// ── Trades ──────────────────────────────────────────────────────────────────

// Where a Trade form goes back to: its Holding's page.
async function holdingPageFor(holdingId: string) {
  const holding = await prisma.holding.findUnique({ where: { id: holdingId }, select: { portfolioId: true } });
  return holding ? `/wealth/portfolios/${holding.portfolioId}/holdings/${holdingId}` : "/wealth";
}

export async function createTrade(
  holdingId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();
  const parsed = tradeSchema.safeParse(formToTradeInput(formData));
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

  let tradeId: string;
  try {
    tradeId = (await createTradeCommand(holdingId, parsed.data)).id;
  } catch (error) {
    return commandError(error, "Holding not found.");
  }

  if (file instanceof File && file.size > 0) {
    await addDocumentCommand("TRADE", tradeId, { file });
  }

  redirect(await holdingPageFor(holdingId));
}

export async function updateTrade(
  holdingId: string,
  tradeId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();
  const parsed = tradeSchema.safeParse(formToTradeInput(formData));
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, TRADE_FIELDS),
    };
  }
  try {
    await updateTradeCommand(tradeId, fullFormUpdate(tradeSchema, parsed.data, formData), { holdingId });
  } catch (error) {
    return commandError(error, "Trade not found.");
  }
  redirect(await holdingPageFor(holdingId));
}

// Permanent: Trades have no Trash yet (#427).
export async function deleteTrade(holdingId: string, tradeId: string): Promise<ActionState> {
  await requireUser();
  try {
    await permanentlyDeleteTradeCommand(tradeId, { holdingId });
  } catch (error) {
    return commandError(error, "Trade not found.");
  }
  return { success: "Trade deleted." };
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

  // `rows` arrives from the client. The ParsedTrade[] type is compile-time
  // only, so validate it for real before any of it reaches the database.
  const validated = importedTradesSchema.safeParse(rows);
  if (!validated.success) {
    return { error: firstIssueMessage(validated.error) };
  }

  let result: { imported: number; skipped: number };
  try {
    result = await importTradesCommand(portfolioId, validated.data);
  } catch (error) {
    return commandError(error, "Portfolio not found.");
  }
  const { imported, skipped } = result;
  return { success: `Imported ${imported} trade${imported !== 1 ? "s" : ""}${skipped ? `, skipped ${skipped} duplicate${skipped !== 1 ? "s" : ""}` : ""}.` };
}

// ── Property Valuations ─────────────────────────────────────────────────────

// Valuations are Property records: their command (commands/home.ts) owns
// the write and the HOME module gate. This turns its errors into the
// ActionState the form shows; anything else is rethrown.
function valuationCommandError(error: unknown, notFound: string): ActionState {
  if (error instanceof RecordNotFoundError) return { error: notFound };
  if (error instanceof ModuleDisabledError) return { error: error.message };
  throw error;
}

async function requireWriter() {
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
  await requireWriter();
  const parsed = propertyValuationSchema.safeParse(formToPropertyValuationInput(formData));
  if (!parsed.success) {
    return {
      error: firstIssueMessage(parsed.error),
      values: formDataToStringValues(formData, VALUATION_FIELDS),
    };
  }

  try {
    await createPropertyValuationCommand(propertyId, parsed.data);
  } catch (error) {
    return valuationCommandError(error, "Property not found.");
  }
  return { success: "Valuation saved." };
}

export async function deletePropertyValuation(
  propertyId: string,
  valuationId: string,
): Promise<ActionState> {
  await requireWriter();
  try {
    await deletePropertyValuationCommand(valuationId, { propertyId });
  } catch (error) {
    return valuationCommandError(error, "Valuation not found.");
  }
  return { success: "Valuation removed." };
}

export async function addPropertyValuation(
  propertyId: string,
  formData: FormData,
): Promise<void> {
  await createPropertyValuation(propertyId, null, formData);
}
