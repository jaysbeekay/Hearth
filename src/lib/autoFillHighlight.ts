import { pillClass } from "@/lib/ui";

// Heuristic (regex/text-match) hits use the accent color; AI-suggested
// values (BYOK or local LLM) use a neutral grey instead, so a reviewer can tell at a
// glance which fields were pattern-matched from the document text versus
// inferred by a model and worth a closer look (#172).
const AUTOFILL_CLASSES = {
  heuristic: ["ring-1", "ring-accent/50", "bg-accent/5"],
  ai: ["ring-2", "ring-foreground/60", "bg-foreground/5"],
};

const AUTOFILL_BADGE_TONE = new Map<"heuristic" | "ai", "accent" | "neutral">([
  ["heuristic", "accent"],
  ["ai", "neutral"],
]);

let autofillDescId = 0;

// Visually marks a field as populated by document extraction. The highlight
// clears itself the moment the user edits that field, since at that point
// it holds the user's value, not the extraction's.
//
// #290: the tint/ring alone was a colour-only signal — invisible to a screen
// reader and easy to miss for a colour-blind reviewer. This also inserts a
// small "Auto" badge (a real DOM node, not text-shadow/color trickery) right
// after the field, plus an `aria-describedby` pointing to a visually-hidden
// explanation. Both are inserted with plain DOM calls, matching this
// function's existing imperative style (it's called from refs, outside
// React's render), and are torn down together with the highlight.
export function markAutoFilled(
  el: HTMLElement | null | undefined,
  source: "heuristic" | "ai" = "heuristic",
) {
  if (!el) return;
  const classes = AUTOFILL_CLASSES[source];
  el.classList.add(...classes);

  const descId = `autofill-desc-${++autofillDescId}`;
  const desc = document.createElement("span");
  desc.id = descId;
  desc.className = "sr-only";
  desc.textContent = "Auto-filled from document — review before saving";
  el.insertAdjacentElement("afterend", desc);
  const previousDescribedBy = el.getAttribute("aria-describedby");
  el.setAttribute("aria-describedby", [previousDescribedBy, descId].filter(Boolean).join(" "));

  const badge = document.createElement("span");
  badge.textContent = "Auto";
  badge.setAttribute("aria-hidden", "true");
  badge.className = pillClass(AUTOFILL_BADGE_TONE.get(source), "mt-1");
  desc.insertAdjacentElement("afterend", badge);

  el.addEventListener(
    "input",
    () => {
      el.classList.remove(...classes);
      desc.remove();
      badge.remove();
      if (previousDescribedBy) el.setAttribute("aria-describedby", previousDescribedBy);
      else el.removeAttribute("aria-describedby");
    },
    { once: true },
  );
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

export const TEXT_EXTRACTION_UNAVAILABLE_MESSAGE =
  "Text extraction isn't available on this server (pdftotext or tesseract isn't installed), " +
  "so nothing was auto-filled. The file still attaches — fill the fields in manually, or ask an " +
  "admin to add an AI key in System settings.";

export function extractionMessage(
  source: ExtractionSource,
  filledCount: number,
  textUnavailable = false,
) {
  const isAi = isAiExtractionSource(source);
  if (filledCount === 0) {
    // #480 — a missing binary used to read the same as a blank document.
    if (textUnavailable) return TEXT_EXTRACTION_UNAVAILABLE_MESSAGE;
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
