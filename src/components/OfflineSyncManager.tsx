"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { RefreshCw, CheckCircle, AlertCircle } from "lucide-react";
import {
  discardOwnOperations,
  getPendingCount,
  getPendingOperations,
  getPendingFilesTotalSize,
  PENDING_FILES_WARN_BYTES,
} from "@/lib/offlineQueue";
import { syncPendingOperations } from "@/lib/offlineSync";
import { whenOfflineDataClaimed } from "@/lib/offlineSession";
import { showToast } from "@/components/Toast";
import { Dialog } from "@/components/Dialog";
import { useCanWrite } from "@/components/CanWriteProvider";
import { buttonVariants, compactButtonClass } from "@/lib/buttonStyles";
import { cn, humanFileSize } from "@/lib/utils";

type SyncState = "idle" | "syncing" | "done" | "error";

export function OfflineSyncManager() {
  const [pendingCount, setPendingCount] = useState(0);
  const [filesInfo, setFilesInfo] = useState({ count: 0, bytes: 0 });
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const syncingRef = useRef(false);

  const canWrite = useCanWrite();
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // Counts changes still mid-sync too: a sync that never finished leaves
  // them "syncing" until the next load resets them (#424).
  const refreshCount = useCallback(async () => {
    const [count, files] = await Promise.all([getPendingCount(), getPendingFilesTotalSize()]);
    setPendingCount(count);
    setFilesInfo(files);
  }, []);

  const runSync = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncState("syncing");
    setMessage(null);

    try {
      if ((await getPendingOperations()).length === 0) {
        setSyncState("idle");
        return;
      }

      const { successCount, failCount } = await syncPendingOperations();
      await refreshCount();
      window.dispatchEvent(new Event("offline-sync-complete"));

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
    } finally {
      syncingRef.current = false;
      await refreshCount();
    }
  }, [refreshCount]);

  // Count on mount, once this load's claim has run, so writes it adopts or
  // resets are included instead of the banner briefly reading 0.
  useEffect(() => {
    whenOfflineDataClaimed()
      .then(() => refreshCount())
      .catch(() => {});
  }, [refreshCount]);

  // Ask the browser not to evict this origin's storage under pressure —
  // losing queued-but-unsynced operations or staged files would be silent
  // data loss, unlike the (unused) `pages` read cache. Grant heuristics are
  // out of app control; this just asks once per session.
  useEffect(() => {
    navigator.storage?.persist?.().catch(() => {});
  }, []);

  // Auto-sync on network restore
  useEffect(() => {
    const onOnline = () => {
      // A read-only member's queued changes can only be refused.
      if (!canWrite) return;
      refreshCount()
        .then(() => runSync())
        .catch(() => {});
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [canWrite, refreshCount, runSync]);

  // Listen for queue additions from forms (custom event)
  useEffect(() => {
    const onQueued = () => {
      refreshCount()
        .then(async () => {
          const { bytes } = await getPendingFilesTotalSize();
          if (bytes > PENDING_FILES_WARN_BYTES) {
            showToast(
              `${humanFileSize(bytes)} of files queued offline — sync soon to free up space on this device.`,
              "info",
            );
          }
        })
        .catch(() => {});
      showToast("Saved offline — will sync when reconnected.", "info");
    };
    window.addEventListener("offline-queued", onQueued);
    return () => window.removeEventListener("offline-queued", onQueued);
  }, [refreshCount]);

  if (pendingCount === 0 && syncState === "idle") return null;

  // #424 review — changes queued before this member was made read-only can
  // never be saved; say so and offer to discard them, rather than retrying.
  if (!canWrite) {
    const changes = pendingCount === 1 ? "1 change" : `${pendingCount} changes`;
    return (
      <div className="flex items-center gap-3 border-b border-border bg-danger/10 px-4 py-2 text-sm text-danger">
        <AlertCircle size={14} className="shrink-0" />
        <span className="flex-1">
          {changes} on this device can&apos;t be saved because your account is now read-only.
        </span>
        <button
          type="button"
          onClick={() => setConfirmDiscard(true)}
          className="shrink-0 rounded px-2 py-0.5 text-xs font-medium underline hover:no-underline"
        >
          Discard
        </button>
        <Dialog
          open={confirmDiscard}
          onClose={() => setConfirmDiscard(false)}
          role="alertdialog"
          describedBy="discard-readonly-text"
        >
          <p id="discard-readonly-text" className="text-sm text-foreground">
            Discard {changes}? They were never saved and can&apos;t be recovered.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmDiscard(false)} className={compactButtonClass()}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmDiscard(false);
                discardOwnOperations()
                  .then(() => refreshCount())
                  .then(() => {
                    window.dispatchEvent(new Event("offline-sync-complete"));
                  })
                  .catch(() => {});
              }}
              className={cn(
                "inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-medium",
                buttonVariants.danger,
              )}
            >
              Discard
            </button>
          </div>
        </Dialog>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-3 border-b border-border px-4 py-2 text-sm ${
        syncState === "error"
          ? "bg-danger/10 text-danger"
          : syncState === "done"
            ? "bg-success/10 text-success"
            : "bg-warning/10 text-warning"
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
            : `${pendingCount} ${pendingCount === 1 ? "change" : "changes"} waiting to sync${
                filesInfo.count > 0
                  ? ` (${filesInfo.count} ${filesInfo.count === 1 ? "file" : "files"}, ${humanFileSize(filesInfo.bytes)})`
                  : ""
              }`)}
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
