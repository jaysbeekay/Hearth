"use client";

import { useEffect } from "react";
import { rememberRecentRecord, type RecentKind } from "@/lib/recentRecords";

// #366 — a record's detail page adds it to Search's "Recently viewed".
export function RememberRecentRecord({ kind, id }: { kind: RecentKind; id: string }) {
  useEffect(() => {
    rememberRecentRecord({ kind, id });
  }, [kind, id]);
  return null;
}
