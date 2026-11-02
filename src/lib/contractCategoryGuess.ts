import type { CONTRACT_CATEGORIES } from "@/lib/validation/contract";

type ContractCategory = (typeof CONTRACT_CATEGORIES)[number];

// #361 — after a document scan, a first guess at the Category from the
// provider and title it found. Most specific first: "car insurance" must win
// over a bare "insurance". Only a guess: it fills an empty select, marked
// Auto like any other extracted field, and the person confirms it.
const RULES: [ContractCategory, RegExp][] = [
  ["CAR_INSURANCE", /\b(car|motor|vehicle|auto)\s+(insurance|cover|policy)\b/i],
  ["STRATA_INSURANCE", /\b(strata|body corporate|sectional title)\b/i],
  ["HOME_INSURANCE", /\b(home|house|building|buildings|contents|household)\s+(and contents\s+)?(insurance|cover|policy)\b/i],
  ["HEALTH_INSURANCE", /\b(health|medical|hospital)\s+(insurance|cover|fund|aid|scheme)\b/i],
  ["LIFE_INSURANCE", /\b(life|funeral|income protection)\s+(insurance|cover|policy)\b/i],
  ["RENTAL", /\b(lease|tenancy|rental agreement|residential tenancy)\b/i],
  ["LOAN", /\b(loan|mortgage|home finance|vehicle finance)\b/i],
  ["TELECOM", /\b(mobile|broadband|internet|fibre|fiber|nbn|phone plan|sim only|cellular)\b/i],
  ["UTILITY", /\b(electricity|energy|gas|water|power|utilities)\b/i],
  ["SUBSCRIPTION", /\b(subscription|membership|streaming|netflix|spotify|disney\+?|youtube premium)\b/i],
  ["WARRANTY", /\b(warranty|extended cover|service plan)\b/i],
];

/** A Category guess from scanned text, or undefined when nothing matches. */
export function guessContractCategory(...texts: (string | null | undefined)[]): ContractCategory | undefined {
  const text = texts.filter(Boolean).join(" ");
  if (!text.trim()) return undefined;
  return RULES.find(([, pattern]) => pattern.test(text))?.[0];
}
