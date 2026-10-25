// #395 — what `?due=soon` / `?due=overdue` select on the Contracts and
// Warranties lists, using today's expiring logic (contractTiming, a fixed
// 30-day window). This is a stand-in: #384 replaces it with the Due policy
// (ADR 0002) behind the same URL parameters, so nothing outside this file
// and its callers should depend on how it decides.
import type { Prisma } from "@/generated/prisma/client";
import { contractTiming, type ContractTimingInput } from "@/lib/contractTiming";
import type { DueFilter } from "@/lib/recordFilters";

const SOON_DAYS = 30;

/**
 * A rough `where` that narrows Contracts to candidates for `due`, plus the
 * in-memory check that decides. Cancelled Contracts are never Due.
 */
export function contractDueFilter(due: DueFilter, now: Date = new Date()) {
  const where: Prisma.ContractWhereInput =
    due === "overdue"
      ? { deletedAt: null, status: "ACTIVE", endDate: { lt: now } }
      : { deletedAt: null, status: "ACTIVE", endDate: { gte: now } };
  const matches = (row: ContractTimingInput & { status: string; deletedAt: Date | null }) => {
    if (row.deletedAt != null || row.status !== "ACTIVE" || row.endDate == null) return false;
    const end = typeof row.endDate === "string" ? new Date(row.endDate) : row.endDate;
    if (due === "overdue") return end < now;
    if (end < now) return false;
    const days = contractTiming(row, now).days;
    return days != null && days >= 0 && days <= SOON_DAYS;
  };
  return { where, matches };
}

/** Warranties: a plain end-date range, as before #395. */
export function warrantyDueWhere(due: DueFilter, now: Date = new Date()): Prisma.ProductWhereInput {
  if (due === "overdue") return { deletedAt: null, warrantyEndDate: { lt: now } };
  const until = new Date(now);
  until.setDate(until.getDate() + SOON_DAYS);
  return { deletedAt: null, warrantyEndDate: { gte: now, lte: until } };
}
