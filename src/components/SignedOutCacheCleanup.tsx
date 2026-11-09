"use client";

import { useEffect } from "react";
import { broadcastSession, clearSignedOutData, markOfflineSession, markSignedOut } from "@/lib/offlineSession";
import { lookupPushSubscription, readSession, settleSignedOutPush } from "@/lib/pushClient";
import { retryUntilSettled } from "@/lib/retryUntilSettled";
import { reuseFirstSession, runSignedOutCleanup } from "@/lib/signedOutCleanup";

// How long to wait before asking the server again when it couldn't say
// whether anyone is signed in.
const SESSION_RETRY_MS = 30_000;

// #424 — the sign-in page normally renders only when this browser has no
// session, whichever way the last one ended: Sign out, a password change, an
// expired session. But a password sign-in's redirect is a push, so the page
// stays in history, and going Back shows it again while still signed in.
// #576 — so it first asks the server whether anyone is signed in, once, and:
// - signed in: leaves everything as it is. Nothing is cleared, no other tab
//   is told, push stays;
// - signed out, or the server couldn't be asked (most likely offline, after
//   a sign-out), it does what it always did:
//   - drop the service worker's cached pages and its session marker, offline
//     Documents and cached list data, so none of it stays on the device;
//   - tell any other open tabs, which then drop their in-memory owner and
//     reload (OfflineSessionGuard) instead of carrying on as the old user;
//   - #375 drop this browser's push subscription, which belongs to whoever
//     was signed in, so a session that ended without Sign out (password
//     change, expiry) doesn't leave their Reminders arriving here. Their
//     server row goes on the next send, when the push service answers 410.
//     This starts only after the clear, which deletes the marker it may
//     write, and reuses the answer above. If the server couldn't be asked,
//     it tries again every 30 seconds and whenever the browser comes back
//     online, for as long as the page is open; should it turn out someone
//     is signed in after all, push stays and the service worker's marker is
//     written again. Whatever happens here, the service worker shows a
//     Reminder's content only while the member it's for is signed in on
//     this browser (pushGate.ts).
// Queued writes are left: they're keyed by user, so only the same user
// signing back in sees and syncs them, and anyone else's sign-in purges them.
export function SignedOutCacheCleanup() {
  useEffect(() => {
    let stopRetry: (() => void) | null = null;
    let unmounted = false;
    // The clear runs even if the page is left before the answer comes: a
    // signed-out browser should still lose the last session's data.
    runSignedOutCleanup({
      readSession: () => readSession(),
      clear: clearSignedOutData,
      broadcast: () => {
        broadcastSession({ type: "signed-out" });
      },
      startPush: (first) => {
        if (unmounted) return;
        const ask = reuseFirstSession(first, () => readSession());
        const drop = () =>
          settleSignedOutPush({ readSession: ask, lookup: lookupPushSubscription, markSignedIn: markOfflineSession, markSignedOut });
        stopRetry = retryUntilSettled(drop, { retryMs: SESSION_RETRY_MS, target: window });
      },
    }).catch(() => {});
    return () => {
      unmounted = true;
      stopRetry?.();
    };
  }, []);
  return null;
}
