import { getOllamaConfig, isOllamaConfigured } from "@/lib/appSettings";
import {
  findCompanyLine,
  findCost,
  findLabeledDate,
  findLabeledValue,
} from "@/lib/documents/textHeuristics";
import { extractWithByok, isByokConfigured } from "@/lib/ai/extract";
import { parseJsonObject, whitelistFields } from "@/lib/ai/parseJson";
import type { ByokUser } from "@/lib/ai/types";

export interface ExtractedInvoiceFields {
  description?: string;
  manufacturer?: string;
  model?: string;
  vendor?: string;
  serialNumber?: string;
  purchaseDate?: string;
  price?: string;
}

const FIELD_KEYS = [
  "description",
  "manufacturer",
  "model",
  "vendor",
  "serialNumber",
  "purchaseDate",
  "price",
] as const;

function findProductDescription(text: string): string | undefined {
  return findLabeledValue(
    text,
    /(product|item)\s*(name|description)?\s*[:#]/i,
    /[:#]\s*(.{3,100})\s*$/,
  );
}

function findManufacturer(text: string): string | undefined {
  return findLabeledValue(
    text,
    /(manufacturer|brand|made by)/i,
    /[:#]?\s*([A-Za-z0-9&'.\- ]{2,60})\s*$/,
  );
}

function findModel(text: string): string | undefined {
  return findLabeledValue(
    text,
    /model\s*(no\.?|number)?\s*[:#]/i,
    /[:#]\s*([A-Za-z0-9-/]{2,40})\s*$/,
  );
}

function findSerialNumber(text: string): string | undefined {
  return findLabeledValue(
    text,
    /(serial\s*(no\.?|number)?|s\/n|imei)/i,
    /[:#]?\s*([A-Za-z0-9-/]{4,40})\s*$/,
  );
}

export function heuristicExtract(text: string): ExtractedInvoiceFields {
  return {
    vendor: findCompanyLine(text),
    manufacturer: findManufacturer(text),
    model: findModel(text),
    description: findProductDescription(text),
    serialNumber: findSerialNumber(text),
    purchaseDate: findLabeledDate(
      text,
      /(invoice date|purchase date|date of purchase|order date|tax invoice|receipt date)/i,
    ),
    price: findCost(text),
  };
}

export function countFound(fields: ExtractedInvoiceFields): number {
  return Object.values(fields).filter((v) => v != null && v !== "").length;
}

const EXTRACTION_INSTRUCTIONS =
  "Extract product purchase details from this invoice or receipt as a single JSON object " +
  "with these optional keys: description (what the product is, e.g. '6kg Vented Dryer'), " +
  "manufacturer (brand), model (model number/code), vendor (retailer/seller), serialNumber, " +
  "purchaseDate (YYYY-MM-DD), price (number only, no currency symbol). Omit keys you cannot " +
  "determine. Respond with JSON only, no other text.";

async function llmExtract(text: string): Promise<ExtractedInvoiceFields | null> {
  const ollama = await getOllamaConfig();
  const prompt = `${EXTRACTION_INSTRUCTIONS}\n\nDocument text:\n${text.slice(0, 6000)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const res = await fetch(`${ollama.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: ollama.model, prompt, format: "json", stream: false }),
      signal: controller.signal,
    });
    if (!res.ok) return null;

    const data = (await res.json()) as { response?: string };
    if (!data.response) return null;
    const parsed = JSON.parse(data.response);
    if (typeof parsed !== "object" || parsed === null) return null;

    return whitelistFields(parsed as Record<string, unknown>, FIELD_KEYS);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function byokExtract(
  byokUser: ByokUser,
  buffer: Buffer,
  mimeType: string,
): Promise<ExtractedInvoiceFields | null> {
  const raw = await extractWithByok(byokUser, buffer, mimeType, EXTRACTION_INSTRUCTIONS);
  if (!raw) return null;
  const parsed = parseJsonObject(raw);
  if (!parsed) return null;
  return whitelistFields(parsed, FIELD_KEYS);
}

// Below this many matched fields, the regex pass is considered unreliable
// (e.g. an unusual layout or noisy OCR) and worth retrying with an LLM.
const LOW_CONFIDENCE_THRESHOLD = 2;

export async function extractInvoiceFields(
  text: string,
  options: { buffer?: Buffer; mimeType?: string; byokUser?: ByokUser | null } = {},
): Promise<{ fields: ExtractedInvoiceFields; source: "byok" | "heuristic" | "llm" | "none" }> {
  if (!text.trim() && !options.buffer) return { fields: {}, source: "none" };

  const heuristic = heuristicExtract(text);
  if (countFound(heuristic) >= LOW_CONFIDENCE_THRESHOLD) {
    return { fields: heuristic, source: "heuristic" };
  }

  if (options.buffer && options.mimeType && isByokConfigured(options.byokUser)) {
    const byok = await byokExtract(options.byokUser, options.buffer, options.mimeType);
    if (byok && countFound(byok) > 0) {
      return { fields: { ...heuristic, ...byok }, source: "byok" };
    }
  }

  if (await isOllamaConfigured()) {
    const llm = await llmExtract(text);
    if (llm && countFound(llm) > 0) {
      return { fields: { ...heuristic, ...llm }, source: "llm" };
    }
  }

  return { fields: heuristic, source: "heuristic" };
}
