"use client";

import { useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { logout } from "@/lib/actions/auth";
import { Dialog } from "@/components/Dialog";
import { showToast } from "@/components/Toast";
import { getPendingCount } from "@/lib/offlineQueue";
import { clearOfflineData } from "@/lib/offlineSession";
import { syncPendingOperations } from "@/lib/offlineSync";
import { buttonVariants, compactButtonClass } from "@/lib/buttonStyles";
import { cn } from "@/lib/utils";

function changes(n: number): string {
  return n === 1 ? "1 change that hasn't" : `${n} changes that haven't`;
}

// #424 — signing out wipes this device's offline data (cached pages, the
// write queue, offline Documents), so the next person to use the browser
// can't see or replay any of it. Unsynced changes would be lost with it, so
// those get a choice first.
export function SignOutButton({
  className,
  iconOnly,
}: {
  className?: string;
  iconOnly?: boolean;
}) {
  const [pendingCount, setPendingCount] = useState(0);
  const [busy, setBusy] = useState<"sync" | "discard" | "signout" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  async function signOut() {
    // Clearing first means nothing survives even if the redirect is slow.
    await clearOfflineData().catch(() => {});
    try {
      await logout();
    } catch (err) {
      const digest = (err as { digest?: string } | null)?.digest;
      if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) throw err;
      setBusy(null);
      setPendingCount(0);
      showToast("Couldn't reach the server to sign out. Try again when you're back online.", "error");
    }
  }

  async function onSignOut() {
    setBusy("signout");
    const count = await getPendingCount().catch(() => 0);
    if (count > 0) {
      setError(null);
      setPendingCount(count);
      setBusy(null);
      return;
    }
    await signOut();
  }

  async function onSyncNow() {
    setError(null);
    if (!navigator.onLine) {
      setError("You're offline. Connect to sync, or discard the changes.");
      return;
    }
    setBusy("sync");
    try {
      const { failCount } = await syncPendingOperations();
      window.dispatchEvent(new Event("offline-sync-complete"));
      const left = await getPendingCount();
      if (failCount > 0 || left > 0) {
        setPendingCount(left);
        setError(`${left === 1 ? "1 change" : `${left} changes`} couldn't sync. Try again, or discard and sign out.`);
        setBusy(null);
        return;
      }
    } catch {
      setError("Sync failed. Check your connection and try again.");
      setBusy(null);
      return;
    }
    await signOut();
  }

  async function onDiscard() {
    setBusy("discard");
    await signOut();
  }

  function close() {
    if (busy) return;
    setPendingCount(0);
    setError(null);
    triggerRef.current?.focus();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => { void onSignOut(); }}
        disabled={busy === "signout"}
        aria-label={iconOnly ? "Sign out" : undefined}
        className={className ?? "flex items-center gap-2 text-sm text-muted hover:text-foreground"}
      >
        <LogOut size={16} />
        {!iconOnly && "Sign out"}
      </button>
      <Dialog
        open={pendingCount > 0}
        onClose={close}
        disableClose={busy !== null}
        role="alertdialog"
        labelledBy="signout-unsynced-title"
        describedBy="signout-unsynced-text"
      >
        <h2 id="signout-unsynced-title" className="text-base font-semibold">
          Unsynced changes
        </h2>
        <p id="signout-unsynced-text" className="mt-2 text-sm text-foreground">
          You have {changes(pendingCount)} synced. Signing out removes them from this device.
        </p>
        {error && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={close}
            className={`${compactButtonClass()} disabled:opacity-50`}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => { void onDiscard(); }}
            className={`${compactButtonClass("danger")} disabled:opacity-50`}
          >
            {busy === "discard" ? "Signing out…" : "Discard and sign out"}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => { void onSyncNow(); }}
            className={cn(
              "inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-medium disabled:opacity-50",
              buttonVariants.primary,
            )}
          >
            {busy === "sync" ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </Dialog>
    </>
  );
}
