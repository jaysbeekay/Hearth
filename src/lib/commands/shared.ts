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

// A write the command refuses because of what it would leave behind (an end
// date before its start date, say), rather than input Zod already caught.
// The message is written for the person and is safe to show as-is.
export class RecordValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordValidationError";
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

// ── Trash rules for writes (#428) ───────────────────────────────────────────
//
// A record in Trash is read-only until it's restored, and so is everything
// under it: a create or update under a parent in Trash, or an update to a
// record that's itself in Trash, is refused as not found (the pages already
// 404 them). Delete, restore and permanent delete still work on it, except
// that a child can't be restored while its parent is still in Trash.
// Offline sync reports each of these as a failed operation with the same
// message.
//
// The check and the write mustn't be separate steps another request can
// slip a move to Trash between. An update puts the rule in its guarded
// write's where clause (updateLiveUnlessStale). A create or restore runs
// its check and its write in one prisma.$transaction, using only `tx`
// inside it: the libsql adapter runs one transaction at a time, so a query
// on the global `prisma` there would wait on the transaction it's in.

/** A row from a table with a Trash (a `deletedAt` column). */
export interface Trashable {
  deletedAt: Date | null;
}

/**
 * A row from a table with no Trash yet (no `deletedAt` column). A row that
 * has one doesn't type-check as this, so when a table gains a Trash (#427)
 * every requireExisting / findExistingParent call on it fails to compile
 * until it moves to requireLive / findLiveParent, rather than silently
 * letting writes through to a trashed record.
 */
export type NoTrash = object & { deletedAt?: never };

/**
 * Whether the record exists and isn't in Trash. For a caller that reports
 * its own message instead of throwing (links.ts). The record must carry its
 * `deletedAt`: select it.
 */
export function isLive(record: Trashable | null | undefined): boolean {
  return record != null && record.deletedAt == null;
}

/** The record if it exists and isn't in Trash; otherwise `what` not found. */
export function requireLive<T extends Trashable>(record: T | null | undefined, what: string): T {
  if (!record || !isLive(record)) throw new RecordNotFoundError(what);
  return record;
}

/**
 * The record if it exists; otherwise `what` not found. Only for tables with
 * no Trash (see NoTrash); a row from a table with one goes to requireLive.
 */
export function requireExisting<T extends NoTrash>(record: T | null | undefined, what: string): T {
  if (!record) throw new RecordNotFoundError(what);
  return record;
}

/**
 * Loads a record for a write to it or under it, refusing one that's missing
 * or in Trash as `what` not found. Despite the name it isn't only for
 * parents: the same call loads the record a write is to (a Vehicle for its
 * own update). `what` is the record the caller is writing, so an update to
 * a Service record under a trashed Vehicle reads "Service record not found".
 */
export async function findLiveParent<T extends Trashable>(
  lookup: PromiseLike<T | null>,
  what: string,
): Promise<T> {
  return requireLive(await lookup, what);
}

/** findLiveParent for a table with no Trash: refuses only a missing record. */
export async function findExistingParent<T extends NoTrash>(
  lookup: PromiseLike<T | null>,
  what: string,
): Promise<T> {
  return requireExisting(await lookup, what);
}

/**
 * updateUnlessStale for a write that must only land on a live record under
 * a live parent. `write` carries the Trash rules in its where clause
 * (`deletedAt: null`, `vehicle: { deletedAt: null }`, ...) as well as the
 * record's scope, so a move to Trash between the caller's checks and the
 * write can't slip through: the write just matches nothing. Nothing is
 * checked before the write; when it matches nothing, `recheck` loads the
 * record (and its parent) and throws the not-found if either is missing,
 * out of scope or in Trash. If they're all live, the record changed under
 * the edit, which is a StaleEditError; with no baseUpdatedAt there's no
 * stale check, and a write that matched nothing (an empty patch on a table
 * with no updatedAt) is left as a no-op.
 */
export async function updateLiveUnlessStale(
  baseUpdatedAt: string | Date | null | undefined,
  write: (guard: { updatedAt?: Date }) => Promise<{ count: number }>,
  recheck: () => Promise<unknown>,
): Promise<void> {
  const base = baseUpdatedAt ? new Date(baseUpdatedAt) : null;
  if (base && Number.isNaN(base.getTime())) {
    await recheck();
    throw new StaleEditError();
  }
  const { count } = await write(base ? { updatedAt: base } : {});
  if (count > 0) return;
  await recheck();
  if (base) throw new StaleEditError();
}

/** A restore refused because the record's parent is still in Trash. */
export class ParentInTrashError extends RecordValidationError {
  constructor(parentLabel: string) {
    super(`Restore the ${parentLabel.toLowerCase()} first.`);
    this.name = "ParentInTrashError";
  }
}

/**
 * For restoring a child: refused while its parent is in Trash. A missing
 * parent can't happen (the child's foreign key cascades), so it's left to
 * the restore's own not-found.
 */
export function assertParentRestored(parent: Trashable | null | undefined, parentLabel: string): void {
  if (parent?.deletedAt) throw new ParentInTrashError(parentLabel);
}
