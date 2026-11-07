"use client";

import { useEffect } from "react";
import { clearOfflineOwner, setOfflineOwner } from "@/lib/offlineOwner";
import {
  broadcastSession,
  claimOfflineData,
  isSigningOut,
  markOfflineSession,
  onSessionBroadcast,
} from "@/lib/offlineSession";
import { readSession } from "@/lib/pushClient";

// #424 — rendered at the top of the signed-in layout. Setting the owner
// while rendering (not in an effect) means it's in place before any page's
// own effects read the offline queue, so they only ever see this user's
// entries. The effect then claims the device's offline data for them and
// tells the service worker who is signed in, and until when.
//
// Other tabs are told too: a sign-out, or a different user signing in,
// makes every other open tab drop its in-memory owner and reload, so a
// stale tab can't keep reading or queueing as the previous user.
export function OfflineSessionGuard({
  userId,
  canWrite,
  expires,
}: {
  userId: string;
  canWrite: boolean;
  expires: string;
}) {
  // Browser only: on the server this module state would be shared by every request.
  // Not mid-sign-out, either: that would hand the cleared tab back its owner.
  if (typeof window !== "undefined" && !isSigningOut()) setOfflineOwner({ userId, canWrite });

  // Keyed on the user only: `expires` moves on every render of the layout,
  // and the claim's database work need only run once per user.
  useEffect(() => {
    claimOfflineData({ userId, canWrite }).catch(() => {});
  }, [userId, canWrite]);

  // `expires` is the session's expiry as of this render. A session revoked
  // early on the server (sessionVersion bump: password change, role change)
  // isn't seen here, so the marker can outlive it until the next load.
  useEffect(() => {
    const expiresAt = Date.parse(expires);
    markOfflineSession(userId, Number.isNaN(expiresAt) ? Date.now() : expiresAt).catch(() => {});
  }, [userId, expires]);

  // #375 — soft navigations keep this layout, and with it `expires`, while
  // the session cookie rolls on with every request. A tab kept open for
  // weeks would let the marker run out under a live session, and the
  // service worker would then hold back this member's Reminders. So the
  // marker is brought up to date whenever the tab comes back into view.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      readSession()
        .then((session) => {
          if (session?.signedIn && session.userId === userId && Number.isFinite(session.expires)) {
            return markOfflineSession(userId, session.expires);
          }
        })
        .catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [userId]);

  useEffect(() => {
    broadcastSession({ type: "signed-in", userId });
    return onSessionBroadcast((message) => {
      if (message.type === "signed-in" && message.userId === userId) return;
      clearOfflineOwner();
      window.location.reload();
    });
  }, [userId]);

  return null;
}
