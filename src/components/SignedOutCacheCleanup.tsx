"use client";

import { useEffect } from "react";
import { broadcastSession, clearSignedOutData, markOfflineSession, markSignedOut } from "@/lib/offlineSession";
import { lookupPushSubscription, readSession, settleSignedOutPush } from "@/lib/pushClient";
import { retryUntilSettled } from "@/lib/retryUntilSettled";

// How long to wait before asking the server again when it couldn't say
// whether anyone is signed in.
const SESSION_RETRY_MS = 30_000;

const dropSignedOutPush = () =>
  settleSignedOutPush({ readSession, lookup: lookupPushSubscription, markSignedIn: markOfflineSession, markSignedOut });

// #424 — the sign-in page only renders when this browser has no session
// (a signed-in visitor is redirected away), whichever way the last one ended:
// Sign out, a password change, an expired session. So:
// - drop the service worker's cached pages and its session marker, offline
//   Documents and cached list data, so none of it stays on the device;
// - tell any other open tabs, which then drop their in-memory owner and
//   reload (OfflineSessionGuard) instead of carrying on as the old user;
// - #375 drop this browser's push subscription, which belongs to whoever was
//   signed in, so a session that ended without Sign out (password change,
//   expiry) doesn't leave their Reminders arriving here. Their server row
//   goes on the next send, when the push service answers 410. Only once the
//   server confirms nobody is signed in: going Back to a cached sign-in page
//   while signed in keeps push, and puts back the service worker's marker
//   the cleared caches took with them. If the server can't be asked, this
//   tries again every 30 seconds and whenever the browser comes back online,
//   for as long as the page is open. Whatever happens here, the service
//   worker shows a Reminder's content only while the member it's for is
//   signed in on this browser (pushGate.ts).
// Queued writes are left: they're keyed by user, so only the same user
// signing back in sees and syncs them, and anyone else's sign-in purges them.
export function SignedOutCacheCleanup() {
  useEffect(() => {
    broadcastSession({ type: "signed-out" });
    // Push only after the clear, which deletes the marker's cache: started
    // together, the clear could delete the marker the push check writes.
    let stopRetry: (() => void) | null = null;
    let unmounted = false;
    clearSignedOutData()
      .catch(() => {})
      .finally(() => {
        if (!unmounted) stopRetry = retryUntilSettled(dropSignedOutPush, { retryMs: SESSION_RETRY_MS, target: window });
      });
    return () => {
      unmounted = true;
      stopRetry?.();
    };
  }, []);
  return null;
}
