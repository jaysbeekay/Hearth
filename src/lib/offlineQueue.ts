import { getDb, QUEUE_STORE, FILES_STORE } from "@/lib/offlineCache";
import { canQueueOffline, getOfflineOwner, isOwnedBy } from "@/lib/offlineOwner";

// Same words as READ_ONLY_MESSAGE in readOnly.ts, which imports server-only
// Next modules this client file can't pull in.
const READ_ONLY_MESSAGE = "Your account has read-only access.";

export type QueuedOpStatus = "pending" | "syncing" | "done" | "failed";

// Serialised mutations stored in IndexedDB when the app is offline.
export interface QueuedOperation {
  id: string;
  // #424 — the user who queued it. Only that user's session ever lists,
  // edits or replays it; /api/sync refuses it from anyone else.
  ownerId?: string;
  timestamp: number;
  label: string;         // user-visible: "Add vehicle", "Edit contract", …
  entity: string;        // "vehicle" | "vehicleItem" | "contract" | "product"
  operation: "create" | "update" | "delete";
  entityId?: string;     // for update / delete
  parentId?: string;     // e.g. vehicleId when creating a vehicleItem
  kind?: string;         // Document kind, for entity "document" (#396)
  formValues?: Record<string, string>; // omitted for delete ops
  // The record's server updatedAt at the moment it was opened for editing —
  // captured for "update" ops so the sync handler can detect (not merge) a
  // conflicting edit that landed elsewhere in the meantime. Omitted for
  // entities without an updatedAt column (currently just RentalAgreement).
  baseUpdatedAt?: string;
  status: QueuedOpStatus;
  error?: string;
}

// File bytes staged alongside a queued create/update op — IndexedDB stores
// Blob/File natively, so no base64 encoding is needed.
export interface PendingFile {
  id: string;
  queueOpId: string;
  fieldName: string; // original FormData field name, e.g. "file", "invoiceFile"
  filename: string;
  mimeType: string;
  size: number;
  blob: Blob;
}

// Split a FormData into plain string values and any File entries.
export function serializeFormData(formData: FormData): {
  values: Record<string, string>;
  files: { fieldName: string; file: File }[];
} {
  const values: Record<string, string> = {};
  const files: { fieldName: string; file: File }[] = [];
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") values[key] = value;
    else if (value.size > 0) files.push({ fieldName: key, file: value });
  }
  return { values, files };
}

// Thrown when nobody who may write is signed in to queue a change for (#424).
export class OfflineQueueRefusedError extends Error {}

export async function enqueueOperation(
  op: Omit<QueuedOperation, "id" | "ownerId" | "timestamp" | "status" | "formValues">,
  formData?: FormData,
): Promise<string | undefined> {
  if (typeof window === "undefined") return undefined;
  const owner = getOfflineOwner();
  if (!owner || !canQueueOffline(owner)) {
    throw new OfflineQueueRefusedError(owner ? READ_ONLY_MESSAGE : "Sign in to save changes offline.");
  }
  const { values, files } = formData
    ? serializeFormData(formData)
    : { values: undefined, files: [] };

  const id = crypto.randomUUID();
  const db = await getDb();
  const tx = db.transaction([QUEUE_STORE, FILES_STORE], "readwrite");
  await tx.objectStore(QUEUE_STORE).add({
    ...op,
    id,
    ownerId: owner.userId,
    timestamp: Date.now(),
    status: "pending",
    formValues: values,
  } satisfies QueuedOperation);
  for (const { fieldName, file } of files) {
    await tx.objectStore(FILES_STORE).add({
      id: crypto.randomUUID(),
      queueOpId: id,
      fieldName,
      filename: file.name,
      mimeType: file.type,
      size: file.size,
      blob: file,
    } satisfies PendingFile);
  }
  await tx.done;
  return id;
}

// #424 — every read and write below sees only the signed-in user's entries.
// OfflineSessionGuard also purges anyone else's, but this holds even before
// that purge has run, or if it never could.
async function ownOperations(): Promise<QueuedOperation[]> {
  const owner = getOfflineOwner();
  if (!owner) return [];
  const db = await getDb();
  const all = (await db.getAllFromIndex(QUEUE_STORE, "by-timestamp")) as QueuedOperation[];
  return all.filter((op) => isOwnedBy(op.ownerId, owner));
}

async function ownOperation(id: string): Promise<QueuedOperation | undefined> {
  const db = await getDb();
  const op = (await db.get(QUEUE_STORE, id)) as QueuedOperation | undefined;
  return op && isOwnedBy(op.ownerId, getOfflineOwner()) ? op : undefined;
}

export async function getFilesForOp(queueOpId: string): Promise<PendingFile[]> {
  if (typeof window === "undefined") return [];
  if (!(await ownOperation(queueOpId))) return [];
  const db = await getDb();
  return (await db.getAllFromIndex(FILES_STORE, "by-op", queueOpId)) as PendingFile[];
}

async function deleteFilesForOp(queueOpId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(FILES_STORE, "readwrite");
  const files = (await tx.store.index("by-op").getAllKeys(queueOpId)) as string[];
  await Promise.all(files.map((fileId) => tx.store.delete(fileId)));
  await tx.done;
}

// Soft warning threshold — not enforced, just surfaced in the UI so a user
// filling in many offline receipts knows how much is staged on-device.
export const PENDING_FILES_WARN_BYTES = 50 * 1024 * 1024;

export async function getPendingFilesTotalSize(): Promise<{ count: number; bytes: number }> {
  if (typeof window === "undefined") return { count: 0, bytes: 0 };
  const ownIds = new Set((await ownOperations()).map((op) => op.id));
  const db = await getDb();
  const all = (await db.getAll(FILES_STORE)) as PendingFile[];
  const own = all.filter((f) => ownIds.has(f.queueOpId));
  return { count: own.length, bytes: own.reduce((sum, f) => sum + f.size, 0) };
}

export async function getPendingOperations(): Promise<QueuedOperation[]> {
  if (typeof window === "undefined") return [];
  const all = await ownOperations();
  return all.filter((op) => op.status === "pending" || op.status === "failed");
}

// Records created while offline have no server-side row yet — list pages
// merge these in as optimistic rows so they're reachable for edit/delete
// before they've synced (see PendingRecordCard).
export async function getPendingCreatesForEntity(entity: string): Promise<QueuedOperation[]> {
  const pending = await getPendingOperations();
  return pending.filter((op) => op.entity === entity && op.operation === "create");
}

export async function getOperationById(id: string): Promise<QueuedOperation | undefined> {
  if (typeof window === "undefined") return undefined;
  return ownOperation(id);
}

// Edits a still-queued "create" in place instead of enqueueing a second,
// conflicting operation — the record doesn't exist server-side yet, so
// there's nothing to send an "update" against.
export async function updateOperationFormValues(
  id: string,
  formValues: Record<string, string>,
): Promise<void> {
  if (typeof window === "undefined") return;
  const op = await ownOperation(id);
  if (!op) return;
  const db = await getDb();
  await db.put(QUEUE_STORE, { ...op, formValues });
}

// Discards a still-queued operation (and any staged files) entirely — no
// server request is ever sent, since the record never existed there.
export async function deleteOperation(id: string): Promise<void> {
  if (typeof window === "undefined") return;
  if (!(await ownOperation(id))) return;
  const db = await getDb();
  await db.delete(QUEUE_STORE, id);
  await deleteFilesForOp(id);
}

export async function getAllOperations(): Promise<QueuedOperation[]> {
  if (typeof window === "undefined") return [];
  return ownOperations();
}

export async function updateOperationStatus(
  id: string,
  status: QueuedOpStatus,
  error?: string,
): Promise<void> {
  if (typeof window === "undefined") return;
  const op = await ownOperation(id);
  if (!op) return;
  const db = await getDb();
  await db.put(QUEUE_STORE, { ...op, status, error });
}

export async function clearDoneOperations(): Promise<void> {
  if (typeof window === "undefined") return;
  const done = (await ownOperations()).filter((op) => op.status === "done");
  const db = await getDb();
  const tx = db.transaction(QUEUE_STORE, "readwrite");
  await Promise.all(done.map((op) => tx.store.delete(op.id)));
  await tx.done;
  await Promise.all(done.map((op) => deleteFilesForOp(op.id)));
}

/**
 * The signed-in user's changes not yet confirmed by the server: waiting,
 * failed, or mid-sync. Mid-sync ones count too, since a sync that never
 * finished leaves them that way until the next load resets them (#424).
 */
export async function getPendingCount(): Promise<number> {
  const ops = await ownOperations();
  return ops.filter((op) => op.status !== "done").length;
}

/**
 * Puts the signed-in user's changes left "syncing" by a sync that never
 * finished (a crashed tab, or a request cut off) back to "pending", so the
 * next sync sends them. Call only when this tab has no sync in flight; a
 * resend of one that did reach the server is a no-op there (#249 receipts).
 */
export async function requeueStuckOperations(): Promise<void> {
  if (typeof window === "undefined") return;
  const stuck = (await ownOperations()).filter((op) => op.status === "syncing");
  await Promise.all(stuck.map((op) => updateOperationStatus(op.id, "pending")));
}

/** Drops all of the signed-in user's queued changes and their staged files. */
export async function discardOwnOperations(): Promise<void> {
  if (typeof window === "undefined") return;
  const ops = await ownOperations();
  await Promise.all(ops.map((op) => deleteOperation(op.id)));
}

// Wraps a server action so that, when offline, the submission is queued
// instead of sent — used by every offline-aware form (`useActionState(makeOfflineAwareAction(...), null)`).
export function makeOfflineAwareAction<S extends { error?: string; success?: string; values?: Record<string, string> } | null>(
  action: (state: S, formData: FormData) => Promise<S>,
  describe: (formData: FormData) => Pick<
    QueuedOperation,
    "label" | "entity" | "operation" | "entityId" | "parentId" | "baseUpdatedAt"
  >,
  offlineSuccess: S,
): (state: S, formData: FormData) => Promise<S> {
  return async (prevState: S, formData: FormData): Promise<S> => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      try {
        await enqueueOperation(describe(formData), formData);
      } catch (err) {
        if (err instanceof OfflineQueueRefusedError) return { error: err.message } as S;
        throw err;
      }
      window.dispatchEvent(new Event("offline-queued"));
      return offlineSuccess;
    }
    return action(prevState, formData);
  };
}
