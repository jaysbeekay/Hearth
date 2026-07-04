import { getOllamaConfig, isOllamaConfigured } from "@/lib/appSettings";
import { INVENTORY_ITEM_CATEGORIES } from "@/lib/validation/inventory";
import {
  findCompanyLine,
  findCost,
  findLabeledDate,
} from "@/lib/documents/textHeuristics";
import { extractWithByok, isByokConfigured } from "@/lib/ai/extract";
import { parseJsonObject, whitelistFields } from "@/lib/ai/parseJson";
import type { ByokUser } from "@/lib/ai/types";

export interface ExtractedInventoryItemFields {
  category?: string;
  label?: string;
  brand?: string;
  model?: string;
  serialNumber?: string;
  purchaseDate?: string;
  purchasePrice?: string;
}

const FIELD_KEYS = [
  "category",
  "label",
  "brand",
  "model",
  "serialNumber",
  "purchaseDate",
  "purchasePrice",
] as const;

function findInventoryCategory(text: string): string | undefined {
  const lower = text.toLowerCase();
  if (/\b(refrigerator|fridge|washer|dryer|dishwasher|oven|microwave|air\s*cond)\b/.test(lower)) return "APPLIANCE";
  if (/\b(laptop|computer|phone|tablet|tv|television|camera|monitor|printer|router)\b/.test(lower)) return "ELECTRONICS";
  if (/\b(sofa|couch|chair|table|desk|bed|bookcase|shelf|wardrobe|cabinet)\b/.test(lower)) return "FURNITURE";
  if (/\b(drill|saw|hammer|wrench|screwdriver|tool|ladder|mower|blower)\b/.test(lower)) return "TOOL";
  if (/\b(jacket|shirt|pants|shoes|boots|coat|dress|suit)\b/.test(lower)) return "CLOTHING";
  if (/\b(bicycle|bike|kayak|surfboard|snowboard|golf|tennis|gym|treadmill)\b/.test(lower)) return "SPORTING";
  if (/\b(book|novel|textbook|manual)\b/.test(lower)) return "BOOK";
  if (/\b(game|dvd|blu-ray|vinyl|record|cd)\b/.test(lower)) return "MEDIA";
  return undefined;
}

function heuristicExtract(text: string): ExtractedInventoryItemFields {
  return {
    category: findInventoryCategory(text),
    brand: findCompanyLine(text),
    purchaseDate: findLabeledDate(text, /(purchase date|date|invoice date|sale date)/i),
    purchasePrice: findCost(text),
  };
}

function countFound(fields: ExtractedInventoryItemFields): number {
  return Object.values(fields).filter((v) => v != null && v !== "").length;
}

const EXTRACTION_INSTRUCTIONS =
  "Extract product/purchase details from this document as a single JSON object " +
  `with these optional keys: category (one of ${INVENTORY_ITEM_CATEGORIES.join(", ")}), ` +
  "label (product name), brand (manufacturer), model (model number/name), serialNumber, " +
  "purchaseDate (YYYY-MM-DD), purchasePrice (number only, no currency symbol). " +
  "Omit keys you cannot determine. Respond with JSON only, no other text.";

async function llmExtract(text: string): Promise<ExtractedInventoryItemFields | null> {
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
): Promise<ExtractedInventoryItemFields | null> {
  const raw = await extractWithByok(byokUser, buffer, mimeType, EXTRACTION_INSTRUCTIONS);
  if (!raw) return null;
  const parsed = parseJsonObject(raw);
  if (!parsed) return null;
  return whitelistFields(parsed, FIELD_KEYS);
}

const LOW_CONFIDENCE_THRESHOLD = 2;

export async function extractInventoryItemFields(
  text: string,
  options: { buffer?: Buffer; mimeType?: string; byokUser?: ByokUser | null } = {},
): Promise<{ fields: ExtractedInventoryItemFields; source: "byok" | "heuristic" | "llm" | "none" }> {
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
