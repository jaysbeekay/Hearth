"use client";

import { useEffect } from "react";
import { broadcastSession, clearSignedOutData } from "@/lib/offlineSession";

// #424 — the sign-in page only renders when this browser has no session
// (a signed-in visitor is redirected away), whichever way the last one ended:
// Sign out, a password change, an expired session. So:
// - drop the service worker's cached pages and its session marker, offline
//   Documents and cached list data, so none of it stays on the device;
// - tell any other open tabs, which then drop their in-memory owner and
//   reload (OfflineSessionGuard) instead of carrying on as the old user.
// Queued writes are left: they're keyed by user, so only the same user
// signing back in sees and syncs them, and anyone else's sign-in purges them.
export function SignedOutCacheCleanup() {
  useEffect(() => {
    clearSignedOutData().catch(() => {});
    broadcastSession({ type: "signed-out" });
  }, []);
  return null;
}
