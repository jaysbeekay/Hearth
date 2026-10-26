import {
  getAllOperations,
  getPendingOperations,
  updateOperationStatus,
  clearDoneOperations,
  getFilesForOp,
} from "@/lib/offlineQueue";

export interface SyncOutcome {
  successCount: number;
  failCount: number;
}

// One drain of the offline queue at a time per tab, whoever asks for it —
// the reconnect auto-sync (OfflineSyncManager) or Sign out's "Sync now".
let inFlight: Promise<SyncOutcome> | null = null;

/**
 * Sends the signed-in user's queued changes to /api/sync. Throws when the
 * request itself fails, leaving them queued; per-change failures come back in
 * `failCount` and stay queued as "failed".
 */
export function syncPendingOperations(): Promise<SyncOutcome> {
  if (!inFlight) {
    inFlight = drainQueue().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function drainQueue(): Promise<SyncOutcome> {
  const pending = await getPendingOperations();
  if (pending.length === 0) return { successCount: 0, failCount: 0 };

  await Promise.all(pending.map((op) => updateOperationStatus(op.id, "syncing")));
  try {
    const body = new FormData();
    body.append("operations", JSON.stringify(pending));
    for (const op of pending) {
      const files = await getFilesForOp(op.id);
      for (const f of files) body.append(`file:${op.id}:${f.fieldName}`, f.blob, f.filename);
    }

    const res = await fetch("/api/sync", { method: "POST", body });
    if (!res.ok) throw new Error("Sync request failed");

    const { results } = (await res.json()) as {
      results: { id: string; success: boolean; error?: string }[];
    };

    let successCount = 0;
    let failCount = 0;
    await Promise.all(
      results.map(async (r) => {
        if (r.success) {
          await updateOperationStatus(r.id, "done");
          successCount++;
        } else {
          await updateOperationStatus(r.id, "failed", r.error);
          failCount++;
        }
      }),
    );
    await clearDoneOperations();
    return { successCount, failCount };
  } catch (err) {
    // Put back what this attempt marked in flight so the next one sends it.
    const sent = new Set(pending.map((op) => op.id));
    const stuck = (await getAllOperations()).filter((op) => sent.has(op.id) && op.status === "syncing");
    await Promise.all(stuck.map((op) => updateOperationStatus(op.id, "pending")));
    throw err;
  }
}
