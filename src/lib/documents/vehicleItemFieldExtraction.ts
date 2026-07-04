import { getOllamaConfig, isOllamaConfigured } from "@/lib/appSettings";
import { VEHICLE_ITEM_TYPES } from "@/lib/validation/vehicles";
import {
  findCompanyLine,
  findCost,
  findLabeledDate,
} from "@/lib/documents/textHeuristics";
import { extractWithByok, isByokConfigured } from "@/lib/ai/extract";
import { parseJsonObject, whitelistFields } from "@/lib/ai/parseJson";
import type { ByokUser } from "@/lib/ai/types";

export interface ExtractedVehicleItemFields {
  type?: string;
  title?: string;
  provider?: string;
  date?: string;
  cost?: string;
}

const FIELD_KEYS = ["type", "title", "provider", "date", "cost"] as const;

function findVehicleItemType(text: string): string | undefined {
  const lower = text.toLowerCase();
  if (/\b(service|oil\s+change|tyre|logbook|scheduled)\b/.test(lower)) return "SERVICE";
  if (/\b(repair|fix(ed)?|replace|damage|collision)\b/.test(lower)) return "REPAIR";
  if (/\b(registr|rego)\b/.test(lower)) return "REGISTRATION";
  if (/\b(insurance|policy|premium|ctp)\b/.test(lower)) return "INSURANCE";
  if (/\b(roadworthy|rwc|safety\s+cert)\b/.test(lower)) return "ROADWORTHY";
  if (/\b(modif|accessory|upgrade)\b/.test(lower)) return "MODIFICATION";
  return undefined;
}

function heuristicExtract(text: string): ExtractedVehicleItemFields {
  return {
    type: findVehicleItemType(text),
    provider: findCompanyLine(text),
    date: findLabeledDate(text, /(invoice date|date|service date|completed)/i),
    cost: findCost(text),
  };
}

function countFound(fields: ExtractedVehicleItemFields): number {
  return Object.values(fields).filter((v) => v != null && v !== "").length;
}

const EXTRACTION_INSTRUCTIONS =
  "Extract vehicle service/record details from this document as a single JSON object " +
  `with these optional keys: type (one of ${VEHICLE_ITEM_TYPES.join(", ")}), title, provider, ` +
  "date (YYYY-MM-DD), cost (number only, no currency symbol). Omit keys you cannot determine. " +
  "Respond with JSON only, no other text.";

async function llmExtract(text: string): Promise<ExtractedVehicleItemFields | null> {
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
): Promise<ExtractedVehicleItemFields | null> {
  const raw = await extractWithByok(byokUser, buffer, mimeType, EXTRACTION_INSTRUCTIONS);
  if (!raw) return null;
  const parsed = parseJsonObject(raw);
  if (!parsed) return null;
  return whitelistFields(parsed, FIELD_KEYS);
}

const LOW_CONFIDENCE_THRESHOLD = 2;

export async function extractVehicleItemFields(
  text: string,
  options: { buffer?: Buffer; mimeType?: string; byokUser?: ByokUser | null } = {},
): Promise<{ fields: ExtractedVehicleItemFields; source: "byok" | "heuristic" | "llm" | "none" }> {
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
