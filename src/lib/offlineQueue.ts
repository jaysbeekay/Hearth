import { getDb, QUEUE_STORE, FILES_STORE } from "@/lib/offlineCache";

export type QueuedOpStatus = "pending" | "syncing" | "done" | "failed";

// Serialised mutations stored in IndexedDB when the app is offline.
export interface QueuedOperation {
  id: string;
  timestamp: number;
  label: string;         // user-visible: "Add vehicle", "Edit contract", …
  entity: string;        // "vehicle" | "vehicleItem" | "contract" | "product"
  operation: "create" | "update" | "delete";
  entityId?: string;     // for update / delete
  parentId?: string;     // e.g. vehicleId when creating a vehicleItem
  formValues?: Record<string, string>; // omitted for delete ops
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

export async function enqueueOperation(
  op: Omit<QueuedOperation, "id" | "timestamp" | "status" | "formValues">,
  formData?: FormData,
): Promise<void> {
  if (typeof window === "undefined") return;
  const { values, files } = formData
    ? serializeFormData(formData)
    : { values: undefined, files: [] };

  const id = crypto.randomUUID();
  const db = await getDb();
  const tx = db.transaction([QUEUE_STORE, FILES_STORE], "readwrite");
  await tx.objectStore(QUEUE_STORE).add({
    ...op,
    id,
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
}

export async function getFilesForOp(queueOpId: string): Promise<PendingFile[]> {
  if (typeof window === "undefined") return [];
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
  const db = await getDb();
  const all = (await db.getAll(FILES_STORE)) as PendingFile[];
  return { count: all.length, bytes: all.reduce((sum, f) => sum + f.size, 0) };
}

export async function getPendingOperations(): Promise<QueuedOperation[]> {
  if (typeof window === "undefined") return [];
  const db = await getDb();
  const all = (await db.getAllFromIndex(QUEUE_STORE, "by-timestamp")) as QueuedOperation[];
  return all.filter((op) => op.status === "pending" || op.status === "failed");
}

export async function getAllOperations(): Promise<QueuedOperation[]> {
  if (typeof window === "undefined") return [];
  const db = await getDb();
  return (await db.getAllFromIndex(QUEUE_STORE, "by-timestamp")) as QueuedOperation[];
}

export async function updateOperationStatus(
  id: string,
  status: QueuedOpStatus,
  error?: string,
): Promise<void> {
  if (typeof window === "undefined") return;
  const db = await getDb();
  const op = (await db.get(QUEUE_STORE, id)) as QueuedOperation | undefined;
  if (!op) return;
  await db.put(QUEUE_STORE, { ...op, status, error });
}

export async function clearDoneOperations(): Promise<void> {
  if (typeof window === "undefined") return;
  const db = await getDb();
  const tx = db.transaction(QUEUE_STORE, "readwrite");
  const all = (await tx.store.getAll()) as QueuedOperation[];
  const done = all.filter((op) => op.status === "done");
  await Promise.all(done.map((op) => tx.store.delete(op.id)));
  await tx.done;
  await Promise.all(done.map((op) => deleteFilesForOp(op.id)));
}

export async function getPendingCount(): Promise<number> {
  const ops = await getPendingOperations();
  return ops.length;
}

// Wraps a server action so that, when offline, the submission is queued
// instead of sent — used by every offline-aware form (`useActionState(makeOfflineAwareAction(...), null)`).
export function makeOfflineAwareAction<S extends { error?: string; success?: string; values?: Record<string, string> } | null>(
  action: (state: S, formData: FormData) => Promise<S>,
  describe: (formData: FormData) => Pick<
    QueuedOperation,
    "label" | "entity" | "operation" | "entityId" | "parentId"
  >,
  offlineSuccess: S,
): (state: S, formData: FormData) => Promise<S> {
  return async (prevState: S, formData: FormData): Promise<S> => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await enqueueOperation(describe(formData), formData);
      window.dispatchEvent(new Event("offline-queued"));
      return offlineSuccess;
    }
    return action(prevState, formData);
  };
}
