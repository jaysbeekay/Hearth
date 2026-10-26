"use client";

import { useEffect } from "react";
import { setOfflineOwner } from "@/lib/offlineOwner";
import { claimOfflineData } from "@/lib/offlineSession";

// #424 — rendered at the top of the signed-in layout. Setting the owner
// while rendering (not in an effect) means it's in place before any page's
// own effects read the offline queue, so they only ever see this user's
// entries. The effect then purges anyone else's and tells the service worker
// who is signed in, and until when.
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
  if (typeof window !== "undefined") setOfflineOwner({ userId, canWrite });

  useEffect(() => {
    const expiresAt = Date.parse(expires);
    claimOfflineData(userId, Number.isNaN(expiresAt) ? Date.now() : expiresAt).catch(() => {});
  }, [userId, expires]);

  return null;
}
