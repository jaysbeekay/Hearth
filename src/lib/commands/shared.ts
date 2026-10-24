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

// Detects (doesn't merge) a conflicting edit. Skipped when no baseUpdatedAt
// was sent (e.g. online form submits, or records with no updatedAt column).
export function assertNotStale(existing: { updatedAt: Date }, baseUpdatedAt?: string | Date | null) {
  if (!baseUpdatedAt) return;
  const base = baseUpdatedAt instanceof Date ? baseUpdatedAt.toISOString() : baseUpdatedAt;
  if (existing.updatedAt.toISOString() !== base) throw new StaleEditError();
}
