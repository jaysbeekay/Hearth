"use client";

import { useEffect } from "react";
import { broadcastSession, clearSignedOutData } from "@/lib/offlineSession";
import { currentPushSubscription, unsubscribeQuietly } from "@/lib/pushClient";

// Going Back to a cached /login after signing in re-mounts this page while
// signed in, so push is only dropped once the server confirms there's no
// session: a signed-in member's subscription can't be restored from here.
async function dropSignedOutPush(): Promise<void> {
  const sub = await currentPushSubscription();
  if (!sub) return;
  const response = await fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) return;
  const session = (await response.json()) as { user?: unknown } | null;
  if (session?.user) return;
  await unsubscribeQuietly(sub);
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
//   expiry) doesn't leave their Reminders arriving here. Its server row goes
//   on the next send, when the push service answers 410.
// Queued writes are left: they're keyed by user, so only the same user
// signing back in sees and syncs them, and anyone else's sign-in purges them.
export function SignedOutCacheCleanup() {
  useEffect(() => {
    clearSignedOutData().catch(() => {});
    dropSignedOutPush().catch(() => {});
    broadcastSession({ type: "signed-out" });
  }, []);
  return null;
}
