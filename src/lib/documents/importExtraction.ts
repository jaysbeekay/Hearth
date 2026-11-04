import { extractTextDetailed } from "@/lib/documents/textExtraction";
import { extractContractFields, heuristicExtract as contractHeuristics } from "@/lib/documents/fieldExtraction";
import { extractInvoiceFields, heuristicExtract as invoiceHeuristics } from "@/lib/documents/invoiceFieldExtraction";
import {
  extractInventoryItemFields,
  heuristicExtract as inventoryHeuristics,
} from "@/lib/documents/inventoryItemFieldExtraction";
import { guessDocumentType, type GuessableType } from "@/lib/documents/classifyDocument";
import type { ByokUser } from "@/lib/ai/types";

export type ImportExtractionSource = "byok" | "heuristic" | "llm" | "none";

export interface ImportExtraction {
  /** The type the file looks like, from the same heuristic the Inbox uses; null when nothing scored. */
  guessedType: GuessableType | null;
  /** Fields for every type the file could be filed as, so switching type needs no second scan. */
  results: Partial<Record<GuessableType, { fields: Record<string, string>; source: ImportExtractionSource }>>;
  textUnavailable: boolean;
}

const asStrings = (fields: object) =>
  Object.fromEntries(Object.entries(fields).filter(([, v]) => typeof v === "string" && v !== "")) as Record<
    string,
    string
  >;

/**
 * #358 — the Upload page's one scan of a file: its text is read once, its
 * type guessed, and fields worked out for every type it could be filed as.
 * Only the guessed type (Contract when there's no guess) escalates to the
 * household's AI provider or Ollama; the others are the heuristic pass over
 * the same text, so a file costs at most one AI call however often its type
 * is switched.
 */
export async function extractForImport(
  buffer: Buffer,
  mimeType: string,
  options: { inventoryEnabled: boolean; byokUser: ByokUser | null },
): Promise<ImportExtraction> {
  const { text, unavailable } = await extractTextDetailed(buffer, mimeType);
  let guessedType = guessDocumentType(text);
  if (guessedType === "INVENTORY" && !options.inventoryEnabled) guessedType = "PRODUCT";
  const primary: GuessableType = guessedType ?? "CONTRACT";
  const full = { buffer, mimeType, byokUser: options.byokUser };
  const heuristic = (fields: object) => {
    const found = asStrings(fields);
    return { fields: found, source: (Object.keys(found).length > 0 ? "heuristic" : "none") as ImportExtractionSource };
  };

  const results: ImportExtraction["results"] = {};
  if (primary === "CONTRACT") {
    const r = await extractContractFields(text, full);
    results.CONTRACT = { fields: asStrings(r.fields), source: r.source };
  } else {
    results.CONTRACT = heuristic(contractHeuristics(text));
  }
  if (primary === "PRODUCT") {
    const r = await extractInvoiceFields(text, full);
    results.PRODUCT = { fields: asStrings(r.fields), source: r.source };
  } else {
    results.PRODUCT = heuristic(invoiceHeuristics(text));
  }
  if (options.inventoryEnabled) {
    if (primary === "INVENTORY") {
      const r = await extractInventoryItemFields(text, full);
      results.INVENTORY = { fields: asStrings(r.fields), source: r.source };
    } else {
      results.INVENTORY = heuristic(inventoryHeuristics(text));
    }
  }
  return { guessedType, results, textUnavailable: unavailable };
}
