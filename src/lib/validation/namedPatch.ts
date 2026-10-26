import type { z } from "zod";

// Partial updates from a caller that names the fields it's changing, such
// as the Assistant (#420). Parse with a `.partial()` schema, then keep only
// what the caller sent: Zod 4's `.partial()` still fills a field's
// `.default()` when the key is absent, which would quietly write
// `status: "ACTIVE"` or `isTaxDeductible: false` over a change that never
// mentioned them. A named key that parses to nothing (a blank string) is
// dropped too, so it changes nothing rather than clearing the field.
export function namedKeysOnly<T extends object>(input: Record<string, unknown>, parsed: T): Partial<T> {
  const named = new Set(Object.keys(input));
  return Object.fromEntries(
    Object.entries(parsed).filter(([key, value]) => named.has(key) && value !== undefined),
  ) as Partial<T>;
}

export type NamedPatchResult<T> =
  | { success: true; data: Partial<T> }
  | { success: false; error: string };

// Parses `input` with a partial schema and returns just the named fields.
// Refuses a patch with nothing to change.
export function parseNamedPatch<T extends object>(
  schema: z.ZodType<T>,
  input: Record<string, unknown>,
): NamedPatchResult<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = namedKeysOnly(input, parsed.data);
  if (Object.keys(data).length === 0) return { success: false, error: "Name at least one field to change." };
  return { success: true, data };
}
