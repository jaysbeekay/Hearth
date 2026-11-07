"use client";

import { useEffect } from "react";
import { pushSubscriptionHeldByOther } from "@/lib/actions/push";
import { currentPushSubscription, unsubscribeQuietly } from "@/lib/pushClient";

// #375 — the fallback for SignedOutCacheCleanup. If a session ended without
// Sign out and the sign-in page couldn't reach the server to confirm it, the
// previous member's subscription is still in this browser. The next member to
// sign in here drops it, on whichever page they land on, not only Settings.
// Their own subscription, or one not saved yet, is left alone.
export function PushOwnerCheck({ userId }: { userId: string }) {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sub = await currentPushSubscription();
      if (!sub || cancelled) return;
      if (await pushSubscriptionHeldByOther({ endpoint: sub.endpoint })) await unsubscribeQuietly(sub);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);
  return null;
}
