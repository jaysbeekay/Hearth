"use client";

import { useOnlineStatus } from "@/lib/useOnlineStatus";

export function OfflineBanner() {
  const online = useOnlineStatus();

  if (online) return null;

  return (
    <div className="sticky top-0 z-50 border-b border-warning/30 bg-warning/10 px-4 py-2 text-center text-sm font-medium text-warning backdrop-blur-sm">
      You are offline — showing cached data. Changes are disabled until you reconnect.
    </div>
  );
}
