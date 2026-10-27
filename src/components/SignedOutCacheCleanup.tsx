"use client";

import { useEffect } from "react";
import { clearRuntimeCaches } from "@/lib/offlineSession";

// #424 — on the sign-in page nobody is signed in, whichever way the last
// session ended (Sign out, a password change, an expired session). Drop the
// service worker's cached pages and its session marker so none of them can
// be served offline. The write queue and offline Documents are left: they're
// keyed by user, so only the same user signing back in sees them, and
// anyone else signing in purges them (OfflineSessionGuard).
export function SignedOutCacheCleanup() {
  useEffect(() => {
    clearRuntimeCaches().catch(() => {});
  }, []);
  return null;
}
