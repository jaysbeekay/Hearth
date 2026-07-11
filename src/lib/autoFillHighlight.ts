const AUTOFILL_CLASSES = ["ring-1", "ring-accent/50", "bg-accent/5"];

// Visually marks a field as populated by document extraction. The highlight
// clears itself the moment the user edits that field, since at that point
// it holds the user's value, not the extraction's.
export function markAutoFilled(el: HTMLElement | null | undefined) {
  if (!el) return;
  el.classList.add(...AUTOFILL_CLASSES);
  el.addEventListener("input", () => el.classList.remove(...AUTOFILL_CLASSES), { once: true });
}

// Client-side mirror of the server's extraction confidence heuristic
// (src/lib/documents/fieldExtraction.ts's LOW_CONFIDENCE_THRESHOLD) — the
// server module is Node/Prisma-only and can't be imported into a client
// component, so this stays a local UI-only judgment call.
const LOW_CONFIDENCE_FIELD_COUNT = 2;

export function extractionMessage(source: "byok" | "heuristic" | "llm" | "none", filledCount: number) {
  if (filledCount === 0) {
    return "Couldn't detect any fields from this document — fill them in manually.";
  }
  if (source === "byok" || source === "llm") {
    return "Fields populated using AI — review before saving.";
  }
  if (filledCount < LOW_CONFIDENCE_FIELD_COUNT) {
    return "Found a few details, but they may be incomplete — double check everything before saving.";
  }
  return "Fields populated from the document — review before saving.";
}
