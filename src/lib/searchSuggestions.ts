import type { SearchResult } from "@/app/api/search/route";
import { formatDueLabel, type DueLabelPreferences } from "@/lib/dueLabel";
import type { AttentionItem } from "@/lib/needsAttention";
import type { RecentKind, RecentRecord } from "@/lib/recentRecords";

// #366 — what Search shows before anything is typed.

export const ATTENTION_SUGGESTION_LIMIT = 3;

export const RECENT_KIND_LABELS = new Map<RecentKind, string>([
  ["contract", "Contract"],
  ["warranty", "Warranty"],
  ["vehicle", "Vehicle"],
  ["property", "Property"],
  ["trip", "Trip"],
  ["inventory", "Item"],
]);

/** The found records in the order they were viewed, most recent first. */
export function orderRecent(recent: RecentRecord[], found: SearchResult[]): SearchResult[] {
  return recent.flatMap((r) => found.find((f) => f.group === r.kind && f.id === r.id) ?? []);
}

/** The first Due rows, each saying when in the viewer's date format. */
// #520 review — the top of the queue as the dashboard orders it: Due rows
// first, then housekeeping when fewer than three things are due.
export function attentionSuggestions(
  queue: { due: AttentionItem[]; housekeeping: AttentionItem[] },
  prefs: DueLabelPreferences,
): SearchResult[] {
  return [...queue.due, ...queue.housekeeping].slice(0, ATTENTION_SUGGESTION_LIMIT).map((item) => ({
    id: item.id,
    title: item.title,
    subtitle: [item.entry ? formatDueLabel(item.entry, prefs) : undefined, item.subtitle].filter(Boolean).join(" · ") || undefined,
    href: item.href,
    group: "attention",
  }));
}
