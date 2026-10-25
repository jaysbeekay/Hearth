// Shared pieces for record commands (ADR 0003). A command throws these, and
// each caller turns them into its own shape: a server action into an
// ActionState error, the sync route into a failed operation's message.

export class RecordNotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "RecordNotFoundError";
  }
}

export class StaleEditError extends Error {
  constructor() {
    super("This record was changed elsewhere since you edited it — review before retrying.");
    this.name = "StaleEditError";
  }
}

export interface UpdateOptions {
  // The record's updatedAt as the client last loaded it (ISO string or Date).
  // When given and the record has moved on since, the update is refused
  // rather than silently overwriting the other edit. Omitted = no check.
  baseUpdatedAt?: string | Date | null;
}

// Detects (doesn't merge) a conflicting edit, atomically (#413). `write` is
// the record's updateMany with `guard` spread into its where clause: with a
// baseUpdatedAt, the guard only matches the row while its updatedAt is still
// that value, so of two edits made from the same base only the first lands
// and the second matches nothing and is refused as stale. A read-compare-
// write would let both pass the compare before either wrote.
//
// Callers confirm the record exists (and is in scope) first, so a not-found
// stays a RecordNotFoundError rather than turning into a stale edit. With no
// baseUpdatedAt (online form submits, records with no updatedAt column) the
// guard is empty and the write is unconditional.
export async function updateUnlessStale(
  baseUpdatedAt: string | Date | null | undefined,
  write: (guard: { updatedAt?: Date }) => Promise<{ count: number }>,
): Promise<void> {
  if (!baseUpdatedAt) {
    await write({});
    return;
  }
  const base = baseUpdatedAt instanceof Date ? baseUpdatedAt : new Date(baseUpdatedAt);
  if (Number.isNaN(base.getTime())) throw new StaleEditError();
  const { count } = await write({ updatedAt: base });
  if (count === 0) throw new StaleEditError();
}
