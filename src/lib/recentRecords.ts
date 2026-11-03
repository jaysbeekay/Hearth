/**
 * #366 — "Recently viewed" in Search. Only each record's kind and id are kept
 * in this browser; Search asks the server for the current titles, so a
 * renamed record reads right and a deleted one, or one in a module that has
 * since been turned off, drops out.
 */

export const RECENT_KINDS = ["contract", "warranty", "vehicle", "property", "trip", "inventory"] as const;
export type RecentKind = (typeof RECENT_KINDS)[number];

export interface RecentRecord {
  kind: RecentKind;
  id: string;
}

export const RECENT_LIMIT = 5;
const STORAGE_KEY = "hearth:recent-records";
// Record ids are cuids; anything else in storage or a URL is ignored.
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function isRecentKind(value: unknown): value is RecentKind {
  return typeof value === "string" && (RECENT_KINDS as readonly string[]).includes(value);
}

function isRecentRecord(value: unknown): value is RecentRecord {
  if (typeof value !== "object" || value === null) return false;
  const { kind, id } = value as Record<string, unknown>;
  return isRecentKind(kind) && typeof id === "string" && ID_PATTERN.test(id);
}

/** `entry` first, without an earlier copy of it, at most `limit` long. */
export function pushRecent(list: RecentRecord[], entry: RecentRecord, limit = RECENT_LIMIT): RecentRecord[] {
  return [entry, ...list.filter((r) => r.kind !== entry.kind || r.id !== entry.id)].slice(0, limit);
}

/** The `recent=` search parameter: `kind:id` pairs, comma-separated. */
export function formatRecentParam(list: RecentRecord[]): string {
  return list.map((r) => `${r.kind}:${r.id}`).join(",");
}

export function parseRecentParam(raw: string | null | undefined): RecentRecord[] {
  if (!raw) return [];
  const records: RecentRecord[] = [];
  for (const part of raw.split(",")) {
    const [kind, id] = part.split(":");
    const record = { kind, id };
    if (isRecentRecord(record) && !records.some((r) => r.kind === kind && r.id === id)) records.push(record);
    if (records.length === RECENT_LIMIT) break;
  }
  return records;
}

// Storage can be unavailable (private mode, blocked site data); Search then
// just has no recent list.
export function readRecentRecords(): RecentRecord[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isRecentRecord).slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

export function rememberRecentRecord(entry: RecentRecord): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pushRecent(readRecentRecords(), entry)));
  } catch {
    // Not remembered; nothing else depends on it.
  }
}
