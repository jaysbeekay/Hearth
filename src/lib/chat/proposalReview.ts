// #530 — helps a member review an Assistant proposal before tapping Confirm.
// The card is the one hard control against a model steered by injected
// text, so it shows each changing field's current value and warns about
// values that look like injection or exfiltration. Warnings never block:
// the member still decides. Pure, so the propose_* tools and tests share it.

/** Fields whose value is text the model wrote, shown in full on the card. */
export const FREE_TEXT_FIELDS: ReadonlySet<string> = new Set([
  "title",
  "description",
  "provider",
  "vendor",
  "contactName",
  "contactPhone",
  "contactEmail",
  "notes",
]);

/** A free-text value longer than this is flagged. Notes may be longer by design, but rarely are. */
export const LONG_VALUE_LENGTH = 500;

const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>]+|\bwww\.[^\s"'<>]+/gi;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

// Text addressed to a model rather than written about the household.
const AI_ADDRESSED_PATTERNS = [
  /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|your|system)\b[^.\n]{0,20}\b(instructions?|prompts?|rules|guidelines)\b/i,
  /(^|\n|\s)(assistant|system|developer)\s*:/i,
  /\byou are now\b/i,
  /\b(new|updated|hidden) instructions\b/i,
  /\b(system|developer) prompt\b/i,
  /\b(as an ai|language model|ai model)\b/i,
];

export const WARNINGS = {
  newLink: "Has a link that isn't on this record.",
  newEmail: "Has an email address that isn't on this record.",
  long: "Unusually long. Read it in full.",
  aiAddressed: "Reads like instructions to an AI, not a household detail.",
} as const;

function stringValues(record: Record<string, unknown> | undefined): string {
  if (!record) return "";
  return Object.values(record)
    .filter((v): v is string => typeof v === "string")
    .join("\n")
    .toLowerCase();
}

/** Warnings for one proposed value. `knownText` is the record's current text, lowercased. */
export function valueWarnings(
  key: string,
  value: unknown,
  knownText: string,
  operation: "create" | "update",
): string[] {
  if (typeof value !== "string" || !value) return [];
  const warnings: string[] = [];
  const isNew = (match: string) => !knownText.includes(match.toLowerCase());

  if ((value.match(URL_PATTERN) ?? []).some(isNew)) warnings.push(WARNINGS.newLink);
  // A new record's own contact email is what that field is for, so only an
  // email elsewhere, or a changed one on an update, is flagged.
  const emailIsTheField = key === "contactEmail" && operation === "create";
  if (!emailIsTheField && (value.match(EMAIL_PATTERN) ?? []).some(isNew)) warnings.push(WARNINGS.newEmail);
  if (value.length > LONG_VALUE_LENGTH) warnings.push(WARNINGS.long);
  if (AI_ADDRESSED_PATTERNS.some((p) => p.test(value))) warnings.push(WARNINGS.aiAddressed);
  return warnings;
}

export interface ProposalReview {
  /** An update's current value for each field it changes. */
  currentValues?: Record<string, unknown>;
  /** Warnings by field, for fields that have any. */
  warnings?: Record<string, string[]>;
}

/**
 * What the card needs beyond the proposal itself. `current` is the record as
 * saved, for an update; a create has none, so every link or email in it
 * (other than its contact email) is new.
 */
export function reviewProposal(
  operation: "create" | "update",
  data: Record<string, unknown>,
  current?: Record<string, unknown>,
): ProposalReview {
  const knownText = stringValues(current);
  const review: ProposalReview = {};

  if (operation === "update" && current) {
    const currentValues: Record<string, unknown> = {};
    for (const key of Object.keys(data)) {
      const value = current[key];
      if (value != null && value !== "") currentValues[key] = value instanceof Date ? value.toISOString() : value;
    }
    if (Object.keys(currentValues).length > 0) review.currentValues = currentValues;
  }

  const warnings: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(data)) {
    const found = valueWarnings(key, value, knownText, operation);
    if (found.length > 0) warnings[key] = found;
  }
  if (Object.keys(warnings).length > 0) review.warnings = warnings;

  return review;
}
