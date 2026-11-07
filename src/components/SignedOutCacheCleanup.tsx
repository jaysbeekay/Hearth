"use client";

import { useEffect } from "react";
import { broadcastSession, clearSignedOutData } from "@/lib/offlineSession";
import { currentPushSubscription, sessionEnded, unsubscribeIfStill } from "@/lib/pushClient";
import { retryUntilSettled } from "@/lib/retryUntilSettled";

// How long to wait before asking the server again when it couldn't say
// whether anyone is signed in.
const SESSION_RETRY_MS = 30_000;

/**
 * Whether push is settled for this page: dropped, nothing to drop, or kept
 * for a member who is in fact signed in. False when the server couldn't be
 * asked or the browser didn't drop it, so it's tried again.
 */
async function dropSignedOutPush(): Promise<boolean> {
  const sub = await currentPushSubscription();
  if (!sub) return true;
  // Going Back to a cached /login after signing in re-mounts this page while
  // signed in, so push is only dropped once the server confirms there's no
  // session: a signed-in member's subscription can't be restored from here.
  const ended = await sessionEnded();
  if (ended === null) return false;
  return ended ? unsubscribeIfStill(sub.endpoint) : true;
}

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
//   goes on the next send, when the push service answers 410. If the server
//   can't confirm the session has ended, this tries again every 30 seconds
//   and whenever the browser comes back online, for as long as the page is
//   open. Whatever happens here, the service worker shows a Reminder only
//   while the member it's for is signed in on this browser (pushGate.ts).
// Queued writes are left: they're keyed by user, so only the same user
// signing back in sees and syncs them, and anyone else's sign-in purges them.
export function SignedOutCacheCleanup() {
  useEffect(() => {
    clearSignedOutData().catch(() => {});
    broadcastSession({ type: "signed-out" });
    return retryUntilSettled(dropSignedOutPush, { retryMs: SESSION_RETRY_MS, target: window });
  }, []);
  return null;
}
