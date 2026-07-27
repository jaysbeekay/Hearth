"use client";

import { useCallback, useEffect, useState } from "react";
import { getPendingCreatesForEntity, type QueuedOperation } from "@/lib/offlineQueue";

// Tracks queued offline "create" operations for one entity type, so a list
// page can render them as optimistic rows before they've synced to the
// server. Refreshes when a new operation is queued and when a sync round
// completes (a completed sync means some of these may have just resolved to
// real server rows — callers should also router.refresh() at that point so
// the newly-synced record appears in the server-fetched list).
export function usePendingCreates(entity: string): {
  pendingOps: QueuedOperation[];
  refresh: () => void;
} {
  const [pendingOps, setPendingOps] = useState<QueuedOperation[]>([]);

  const refresh = useCallback(() => {
    getPendingCreatesForEntity(entity)
      .then(setPendingOps)
      .catch(() => {});
  }, [entity]);

  useEffect(() => {
    refresh();
    window.addEventListener("offline-queued", refresh);
    window.addEventListener("offline-sync-complete", refresh);
    return () => {
      window.removeEventListener("offline-queued", refresh);
      window.removeEventListener("offline-sync-complete", refresh);
    };
  }, [refresh]);

  return { pendingOps, refresh };
}
