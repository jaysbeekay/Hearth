import type { z } from "zod";

// Partial updates from a caller that names the fields it's changing, such
// as the Assistant (#420). Parse with a `.partial()` schema, then keep only
// what the caller sent: Zod 4's `.partial()` still fills a field's
// `.default()` when the key is absent, which would quietly write
// `status: "ACTIVE"` or `isTaxDeductible: false` over a change that never
// mentioned them.
//
// A key whose value is `null` or `undefined` doesn't count as named: it's
// dropped before parsing, so it neither fails a field with no blank handling
// (status, isTaxDeductible, currency) nor keeps that field's default. A named
// key that parses to nothing (a blank string) is dropped too, so it changes
// nothing rather than clearing the field. A falsy value (`false`, `0`) is a
// real change and is kept.
export type NamedPatchResult<T> =
  | { success: true; data: Partial<T> }
  | { success: false; error: string };

// Parses `input` with a partial schema and returns just the named fields.
// Refuses a patch with nothing to change.
export function parseNamedPatch<T extends object>(
  schema: z.ZodType<T>,
  input: Record<string, unknown>,
): NamedPatchResult<T> {
  const given = Object.fromEntries(Object.entries(input).filter(([, value]) => value != null));
  const parsed = schema.safeParse(given);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const named = new Set(Object.keys(given));
  const data = Object.fromEntries(
    Object.entries(parsed.data).filter(([key, value]) => named.has(key) && value !== undefined),
  ) as Partial<T>;
  if (Object.keys(data).length === 0) return { success: false, error: "Name at least one field to change." };
  return { success: true, data };
}
