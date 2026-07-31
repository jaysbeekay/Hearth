"use client";

import { useDismissible } from "@/lib/useDismissible";

// Wraps one row of the Needs Attention queue so it can carry its own
// "don't show this again" state, the same way NotificationNudgeBanner used
// to — the queue itself is a server component (it binds server actions
// directly, e.g. setContractStatus), so only the one row that needs
// client-side dismiss state is split out like this rather than converting
// the whole list to a client component.
export function DismissibleRow({
  dismissKey,
  children,
}: {
  dismissKey: string;
  children: React.ReactNode;
}) {
  const [dismissed] = useDismissible(dismissKey);
  if (dismissed) return null;
  return <>{children}</>;
}
