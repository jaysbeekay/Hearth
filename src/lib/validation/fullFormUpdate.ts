// Full-form updates vs partial patches (#413).
//
// The Zod schemas run optional fields through emptyToUndefined, so a field
// the user blanked parses to `undefined`, and Prisma skips `undefined` keys:
// the old value stayed. That's right for a partial patch (extraction review,
// status changes, the Assistant), where an absent key means "not sent", but
// wrong for an edit form, where a blank field means "cleared".
//
// An edit form's submission says which fields it sent: FormData (and the
// offline queue's formValues, which are serialized from it) carries every
// rendered input, blank ones as "". fullFormUpdate turns the parsed input
// into a patch where every schema field the form submitted but which parsed
// to nothing becomes `null`, so Prisma clears it. Fields the form didn't
// render at all (a linked Vehicle select while the Vehicles module is off,
// say) aren't in the submission, so they stay untouched rather than being
// wiped by a form that never showed them.

/** A patch where optional fields may also be `null`, meaning "clear it". */
export type ClearablePatch<T> = {
  [K in keyof T]?: undefined extends T[K] ? T[K] | null : T[K];
};

// `submission` is the FormData the form posted, or the offline queue's
// formValues for the same form.
export function fullFormUpdate<T extends object>(
  schema: { shape: object },
  data: T,
  submission: FormData | Record<string, unknown>,
): ClearablePatch<T> {
  const submitted = new Set(submission instanceof FormData ? submission.keys() : Object.keys(submission));
  const parsed = new Map<string, unknown>(Object.entries(data));
  const cleared = Object.keys(schema.shape)
    .filter((key) => submitted.has(key) && parsed.get(key) === undefined)
    .map((key) => [key, null] as const);
  return { ...data, ...Object.fromEntries(cleared) };
}
