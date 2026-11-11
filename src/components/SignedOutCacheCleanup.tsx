"use client";

import { useEffect } from "react";
import { broadcastSession, clearSignedOutData, markOfflineSession, markSignedOut } from "@/lib/offlineSession";
import { lookupPushSubscription, readSession, settleSignedOutPush } from "@/lib/pushClient";
import { cancelDeviceReminders } from "@/lib/nativeReminders";
import { retryUntilSettled } from "@/lib/retryUntilSettled";
import { runSignedOutCleanup } from "@/lib/signedOutCleanup";

// How long to wait before asking the server again when it couldn't say
// whether anyone is signed in.
const SESSION_RETRY_MS = 30_000;

// How long the gate waits for the server before treating the answer as
// unknown and clearing, as an offline sign-in page should.
const GATE_TIMEOUT_MS = 4_000;

// #424 — the sign-in page normally renders only when this browser has no
// session, whichever way the last one ended: Sign out, a password change, an
// expired session. But a password sign-in's redirect is a push, so the page
// stays in history, and going Back shows it again while still signed in.
// #576 — so it first asks the server whether anyone is signed in, and:
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
//     write, and asks the server again. If the server couldn't be asked,
//     it tries again every 30 seconds and whenever the browser comes back
//     online, for as long as the page is open; should it turn out someone
//     is signed in after all, push stays and the service worker's marker is
//     written again. Whatever happens here, the service worker shows a
//     Reminder's content only while the member it's for is signed in on
//     this browser (pushGate.ts).
// If this page is left while the answer is on its way (most likely by signing
// in from it), it asks once more before clearing, so a late answer can't
// clear the new session's data.
// Queued writes are left: they're keyed by user, so only the same user
// signing back in sees and syncs them, and anyone else's sign-in purges them.
export function SignedOutCacheCleanup() {
  useEffect(() => {
    let stopRetry: (() => void) | null = null;
    let unmounted = false;
    // The clear still runs if a client-side navigation leaves the page before
    // the answer comes (after asking again): a signed-out browser should
    // still lose the last session's data.
    runSignedOutCleanup({
      readSession: () => readSession(fetch, GATE_TIMEOUT_MS),
      hasLeft: () => unmounted,
      // #375 — in the phone app, Reminders scheduled on the device hold
      // household records' names, so they go with the cached data, once nobody
      // is signed in. Whether they were on is kept: the same member's next
      // sign-in schedules them again, and anyone else's turns them off
      // (DeviceReminderSync).
      clear: async () => {
        void cancelDeviceReminders().catch(() => {});
        await clearSignedOutData();
      },
      broadcast: () => {
        broadcastSession({ type: "signed-out" });
      },
      startPush: () => {
        if (unmounted) return;
        const drop = () =>
          settleSignedOutPush({ readSession: () => readSession(), lookup: lookupPushSubscription, markSignedIn: markOfflineSession, markSignedOut });
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
