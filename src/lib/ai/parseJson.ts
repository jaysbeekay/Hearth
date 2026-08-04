// Cloud providers are instructed to respond with JSON only, but unlike the
// local Ollama call (which can force this with format: "json"), they
// sometimes wrap the object in a markdown code fence or add stray text —
// so parsing here is intentionally lenient.
export function parseJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  const candidate = cleaned.match(/\{[\s\S]*\}/)?.[0] ?? cleaned;

  try {
    const parsed = JSON.parse(candidate);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// Every extracted field (dates, amounts, names, short labels) is legitimately
// short — the longest heuristic-matched value elsewhere in the pipeline caps
// at 100 chars. A value blowing past this is either a mis-extraction or a
// model that got steered by injected instruction text hiding in the source
// document; either way it's dropped rather than passed on to the review form.
const MAX_FIELD_LENGTH = 300;

export function whitelistFields<K extends string>(
  parsed: Record<string, unknown>,
  keys: readonly K[],
): Partial<Record<K, string>> {
  const fields: Partial<Record<K, string>> = {};
  for (const key of keys) {
    const value = parsed[key];
    if (typeof value === "string" && value.trim() && value.trim().length <= MAX_FIELD_LENGTH) {
      fields[key] = value.trim();
    } else if (typeof value === "number") {
      fields[key] = String(value);
    }
  }
  return fields;
}
