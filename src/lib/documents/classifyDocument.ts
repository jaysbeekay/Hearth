import {
  heuristicExtract as extractContractHeuristics,
  countFound as countContractFields,
} from "@/lib/documents/fieldExtraction";
import {
  heuristicExtract as extractInvoiceHeuristics,
  countFound as countInvoiceFields,
} from "@/lib/documents/invoiceFieldExtraction";
import {
  heuristicExtract as extractInventoryHeuristics,
  countFound as countInventoryFields,
} from "@/lib/documents/inventoryItemFieldExtraction";

export type GuessableType = "CONTRACT" | "PRODUCT" | "INVENTORY";

// Below this many matched fields, a guess isn't worth pre-selecting — the
// document is left fully unclassified, same as today's manual-only inbox
// (#195). Deliberately heuristic-only: this runs once per ingested email and
// must never trigger a cloud AI call or local Ollama request just to guess a
// type — only the classify-time extraction (already user-initiated) escalates.
const GUESS_THRESHOLD = 2;

export function guessDocumentType(text: string): GuessableType | null {
  if (!text.trim()) return null;

  const scores: { type: GuessableType; count: number }[] = [
    { type: "CONTRACT", count: countContractFields(extractContractHeuristics(text)) },
    { type: "PRODUCT", count: countInvoiceFields(extractInvoiceHeuristics(text)) },
    { type: "INVENTORY", count: countInventoryFields(extractInventoryHeuristics(text)) },
  ];

  const best = scores.reduce((a, b) => (b.count > a.count ? b : a));
  return best.count >= GUESS_THRESHOLD ? best.type : null;
}
