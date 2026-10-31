"use client";

import { useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { logout } from "@/lib/actions/auth";
import { Dialog } from "@/components/Dialog";
import { showToast } from "@/components/Toast";
import { getPendingCount } from "@/lib/offlineQueue";
import { withTimeout } from "@/lib/offlineOwner";
import { useCanWrite } from "@/components/CanWriteProvider";
import {
  clearOfflineData,
  restoreOfflineSession,
  whenOfflineDataClaimed,
} from "@/lib/offlineSession";
import { awaitSyncIdle, syncPendingOperations } from "@/lib/offlineSync";
import { buttonClass } from "@/lib/ui";

// How long the pre-sign-out check may take before we stop waiting on
// IndexedDB and say so, rather than hang or assume nothing is unsynced.
const CHECK_TIMEOUT_MS = 3_000;

function changesThatHavent(n: number): string {
  return n === 1 ? "1 change that hasn't" : `${n} changes that haven't`;
}

function isRedirect(err: unknown): boolean {
  const digest = (err as { digest?: string } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

type Prompt = { kind: "unsynced"; count: number } | { kind: "unknown" };

// #424 — signing out clears this device's offline data (cached pages, the
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
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [busy, setBusy] = useState<"sync" | "discard" | "signout" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // A member demoted to read-only can't sync what they queued before.
  const canSync = useCanWrite();

  async function signOut() {
    // Signing out needs the server; clearing first and then failing would
    // leave this tab signed in with its offline data gone.
    if (!navigator.onLine) {
      setBusy(null);
      showToast("You're offline. Sign out when you're back online.", "error");
      return;
    }
    // A sync still running would otherwise send changes without their
    // files, or finish after the queue it's reading was cleared.
    await awaitSyncIdle();
    // Other tabs are told from the sign-in page once the session is really
    // gone (SignedOutCacheCleanup), not here, where they'd reload too early.
    await clearOfflineData();
    try {
      await logout();
    } catch (err) {
      if (!isRedirect(err)) {
        // Still signed in after all: put back this tab's owner and the
        // service worker's session marker so offline use keeps working.
        await restoreOfflineSession();
        setBusy(null);
        setPrompt(null);
        showToast("Couldn't reach the server to sign out. Try again when you're back online.", "error");
        return;
      }
    }
    // A full page load, not a client-side navigation, so the router cache
    // and Back can't show the signed-out user's pages (#424 review).
    window.location.replace("/login");
  }

  async function onSignOut() {
    setBusy("signout");
    setError(null);
    let count: number;
    try {
      await whenOfflineDataClaimed();
      // Count once any sync in flight has settled: changes it's sending are
      // neither safely synced nor safely discardable until then.
      await awaitSyncIdle();
      count = await withTimeout(getPendingCount(), CHECK_TIMEOUT_MS);
    } catch {
      setPrompt({ kind: "unknown" });
      setBusy(null);
      return;
    }
    if (count > 0) {
      setPrompt({ kind: "unsynced", count });
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
      const left = await withTimeout(getPendingCount(), CHECK_TIMEOUT_MS);
      if (failCount > 0 || left > 0) {
        setPrompt({ kind: "unsynced", count: left });
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
    setPrompt(null);
    setError(null);
    triggerRef.current?.focus();
  }

  const unknown = prompt?.kind === "unknown";
  const unsynced = prompt?.kind === "unsynced" ? prompt.count : 0;
  let body = `You have ${changesThatHavent(unsynced)} synced. Signing out removes them from this device.`;
  if (unknown) {
    body = "This device's offline storage didn't respond, so any changes waiting to sync may be lost if you sign out now.";
  } else if (!canSync) {
    body = `You have ${changesThatHavent(unsynced)} synced. These changes can't be saved because your account is now read-only.`;
  }
  let discardLabel = unknown ? "Sign out anyway" : "Discard and sign out";
  if (busy === "discard") discardLabel = "Signing out…";

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
        open={prompt !== null}
        onClose={close}
        disableClose={busy !== null}
        role="alertdialog"
        labelledBy="signout-unsynced-title"
        describedBy="signout-unsynced-text"
      >
        <h2 id="signout-unsynced-title" className="text-base font-medium">
          {unknown ? "Couldn't check for unsynced changes" : "Unsynced changes"}
        </h2>
        <p id="signout-unsynced-text" className="mt-2 text-sm text-foreground">
          {body}
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
            className={`${buttonClass("secondary")} disabled:opacity-50`}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => { void onDiscard(); }}
            className={`${buttonClass("secondary", { destructive: true })} disabled:opacity-50`}
          >
            {discardLabel}
          </button>
          {prompt?.kind === "unsynced" && canSync && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => { void onSyncNow(); }}
              className={buttonClass("primary")}
            >
              {busy === "sync" ? "Syncing…" : "Sync now"}
            </button>
          )}
        </div>
      </Dialog>
    </>
  );
}
