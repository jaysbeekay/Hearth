import { getDb, QUEUE_STORE } from "@/lib/offlineCache";

export type QueuedOpStatus = "pending" | "syncing" | "done" | "failed";

// Serialised mutations stored in IndexedDB when the app is offline.
// Files are excluded — they are online-only in Phase 2.
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

// Strip File objects; keep only string values.
export function serializeFormData(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

export async function enqueueOperation(
  op: Omit<QueuedOperation, "id" | "timestamp" | "status">,
): Promise<void> {
  if (typeof window === "undefined") return;
  const db = await getDb();
  await db.add(QUEUE_STORE, {
    ...op,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    status: "pending",
  } satisfies QueuedOperation);
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
  await Promise.all(
    all.filter((op) => op.status === "done").map((op) => tx.store.delete(op.id)),
  );
  await tx.done;
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
      await enqueueOperation({
        ...describe(formData),
        formValues: serializeFormData(formData),
      });
      window.dispatchEvent(new Event("offline-queued"));
      return offlineSuccess;
    }
    return action(prevState, formData);
  };
}
