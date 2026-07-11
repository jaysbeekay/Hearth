"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { RefreshCw, CheckCircle, AlertCircle } from "lucide-react";
import {
  getPendingOperations,
  updateOperationStatus,
  clearDoneOperations,
  type QueuedOperation,
} from "@/lib/offlineQueue";
import { showToast } from "@/components/Toast";

type SyncState = "idle" | "syncing" | "done" | "error";

export function OfflineSyncManager() {
  const [pendingCount, setPendingCount] = useState(0);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const syncingRef = useRef(false);

  const refreshCount = useCallback(async () => {
    const ops = await getPendingOperations();
    setPendingCount(ops.length);
  }, []);

  const runSync = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncState("syncing");
    setMessage(null);

    try {
      const pending = await getPendingOperations();
      if (pending.length === 0) {
        setSyncState("idle");
        return;
      }

      await Promise.all(
        pending.map((op) => updateOperationStatus(op.id, "syncing")),
      );

      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operations: pending }),
      });

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
      await refreshCount();

      if (failCount === 0) {
        setSyncState("done");
        const doneMessage = `${successCount} ${successCount === 1 ? "change" : "changes"} synced successfully.`;
        setMessage(doneMessage);
        showToast(doneMessage);
        setTimeout(() => {
          setSyncState("idle");
          setMessage(null);
        }, 4000);
      } else {
        setSyncState("error");
        setMessage(
          `${successCount} synced, ${failCount} failed — check your connection and try again.`,
        );
      }
    } catch {
      setSyncState("error");
      setMessage("Sync failed — will retry when reconnected.");
      const pending = await getPendingOperations();
      await Promise.all(
        pending
          .filter((op) => (op as QueuedOperation).status === "syncing")
          .map((op) => updateOperationStatus(op.id, "pending")),
      );
    } finally {
      syncingRef.current = false;
      await refreshCount();
    }
  }, [refreshCount]);

  // Poll count on mount and after operations
  useEffect(() => {
    refreshCount().catch(() => {});
  }, [refreshCount]);

  // Auto-sync on network restore
  useEffect(() => {
    const onOnline = () => {
      refreshCount()
        .then(() => runSync())
        .catch(() => {});
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [refreshCount, runSync]);

  // Listen for queue additions from forms (custom event)
  useEffect(() => {
    const onQueued = () => {
      refreshCount().catch(() => {});
      showToast("Saved offline — will sync when reconnected.", "info");
    };
    window.addEventListener("offline-queued", onQueued);
    return () => window.removeEventListener("offline-queued", onQueued);
  }, [refreshCount]);

  if (pendingCount === 0 && syncState === "idle") return null;

  return (
    <div
      className={`flex items-center gap-3 border-b border-border px-4 py-2 text-sm ${
        syncState === "error"
          ? "bg-danger/10 text-danger"
          : syncState === "done"
            ? "bg-success/10 text-success"
            : "bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
      }`}
    >
      {syncState === "syncing" && (
        <RefreshCw size={14} className="shrink-0 animate-spin" />
      )}
      {syncState === "done" && <CheckCircle size={14} className="shrink-0" />}
      {syncState === "error" && <AlertCircle size={14} className="shrink-0" />}
      {syncState === "idle" && pendingCount > 0 && (
        <RefreshCw size={14} className="shrink-0" />
      )}

      <span className="flex-1">
        {message ??
          (syncState === "syncing"
            ? "Syncing changes…"
            : `${pendingCount} ${pendingCount === 1 ? "change" : "changes"} waiting to sync`)}
      </span>

      {syncState === "idle" && pendingCount > 0 && navigator?.onLine && (
        <button
          onClick={() => runSync()}
          className="shrink-0 rounded px-2 py-0.5 text-xs font-medium underline hover:no-underline"
        >
          Sync now
        </button>
      )}
    </div>
  );
}
