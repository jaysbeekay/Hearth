// Heuristic (regex/text-match) hits use the accent color; AI-suggested
// values (BYOK or local LLM) use info instead, so a reviewer can tell at a
// glance which fields were pattern-matched from the document text versus
// inferred by a model and worth a closer look (#172).
const AUTOFILL_CLASSES = {
  heuristic: ["ring-1", "ring-accent/50", "bg-accent/5"],
  ai: ["ring-1", "ring-info/50", "bg-info/5"],
};

// Visually marks a field as populated by document extraction. The highlight
// clears itself the moment the user edits that field, since at that point
// it holds the user's value, not the extraction's.
export function markAutoFilled(
  el: HTMLElement | null | undefined,
  source: "heuristic" | "ai" = "heuristic",
) {
  if (!el) return;
  const classes = AUTOFILL_CLASSES[source];
  el.classList.add(...classes);
  el.addEventListener("input", () => el.classList.remove(...classes), { once: true });
}

// Fills a field with an extracted value only if the user hasn't already put
// something there. #301: every applyExtractedFields-style function used to
// overwrite unconditionally (bar one field that happened to check first), so
// re-scanning a document after typing a correction silently discarded it.
export function applyIfEmpty(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null | undefined,
  value: string | undefined,
  source: "heuristic" | "ai" = "heuristic",
) {
  if (!value || !el || el.value) return;
  el.value = value;
  markAutoFilled(el, source);
}

// Client-side mirror of the server's extraction confidence heuristic
// (src/lib/documents/fieldExtraction.ts's LOW_CONFIDENCE_THRESHOLD) — the
// server module is Node/Prisma-only and can't be imported into a client
// component, so this stays a local UI-only judgment call.
const LOW_CONFIDENCE_FIELD_COUNT = 2;

export type ExtractionSource = "byok" | "heuristic" | "llm" | "none";

export function isAiExtractionSource(source: ExtractionSource) {
  return source === "byok" || source === "llm";
}

export function extractionMessage(source: ExtractionSource, filledCount: number) {
  const isAi = isAiExtractionSource(source);
  if (filledCount === 0) {
    return "Couldn't confidently detect anything in this document — fill the fields in manually.";
  }
  if (filledCount < LOW_CONFIDENCE_FIELD_COUNT) {
    return isAi
      ? "AI found a couple of details, but couldn't confidently fill in the rest — review everything below before saving."
      : "Only found a few details, and couldn't confidently detect the rest — review everything below before saving.";
  }
  return isAi
    ? "Fields populated using AI — review before saving, especially any that still look off."
    : "Fields populated from the document — review before saving.";
}
