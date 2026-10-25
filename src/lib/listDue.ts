// #395/#384 — what `?due=soon` / `?due=overdue` select on the Contracts and
// Warranties lists, their chip counts, and Search's same filters. The Due
// policy decides (ADR 0002): each filter is a rough `where` that only
// narrows candidates, plus the in-memory `matches` that asks the policy.
// Don't tighten the `where` into exact SQL; that's how lists and Search
// came to disagree.
//
// - `soon`: an entry is due soon, inside the record's own due-soon window.
// - `overdue`: on Contracts, an Expired (manual-renewal) one. Ended and
//   auto-renewing Contracts are never overdue. On Warranties, which are
//   never Due, it selects Lapsed ones, so the list's "Lapsed" chip has
//   something to show. On Vehicles, any date that has passed.
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { CalendarDay, DueContext, DueEntry } from "@/lib/duePolicy";
import { contractDue, vehicleDue, warrantyDue, type ContractDueRow, type VehicleDueRow, type WarrantyDueRow } from "@/lib/dueRecords";
import type { DueFilter } from "@/lib/recordFilters";

/** UTC midnight of a calendar day: how stored dates compare with it. */
export function dayStart(day: CalendarDay): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function hasState(entries: DueEntry[], state: DueEntry["state"]): boolean {
  return entries.some((entry) => entry.state === state);
}

/** The fields the policy needs from a Contract, for a Prisma `select`. */
export const CONTRACT_DUE_SELECT = {
  deletedAt: true,
  status: true,
  endDate: true,
  noticePeriodDays: true,
  renewalType: true,
  reminderDaysBefore: true,
} as const satisfies Prisma.ContractSelect;

export const WARRANTY_DUE_SELECT = {
  deletedAt: true,
  warrantyEndDate: true,
  reminderDaysBefore: true,
} as const satisfies Prisma.ProductSelect;

export const VEHICLE_DUE_SELECT = {
  deletedAt: true,
  regoExpiry: true,
  insuranceExpiry: true,
  nextServiceDue: true,
  reminderDaysBefore: true,
} as const satisfies Prisma.VehicleSelect;

type Live = { deletedAt: Date | null };

export function contractDueFilter(due: DueFilter, ctx: DueContext) {
  const today = dayStart(ctx.today);
  // A notice deadline is before its end date, so anything due soon still
  // has an end date of today or later.
  const where: Prisma.ContractWhereInput = {
    deletedAt: null,
    status: { not: "CANCELLED" },
    endDate: due === "overdue" ? { lt: today } : { gte: today },
  };
  const matches = (row: ContractDueRow & Live) => {
    if (row.deletedAt != null) return false;
    return hasState(contractDue(row, ctx), due === "overdue" ? "overdue" : "due-soon");
  };
  return { where, matches };
}

export function warrantyDueFilter(due: DueFilter, ctx: DueContext) {
  const today = dayStart(ctx.today);
  const where: Prisma.ProductWhereInput = {
    deletedAt: null,
    warrantyEndDate: due === "overdue" ? { lt: today } : { gte: today },
  };
  const matches = (row: WarrantyDueRow & Live) => {
    if (row.deletedAt != null) return false;
    return hasState(warrantyDue(row, ctx), due === "overdue" ? "lapsed" : "due-soon");
  };
  return { where, matches };
}

export function vehicleDueFilter(due: DueFilter, ctx: DueContext) {
  const today = dayStart(ctx.today);
  const range = due === "overdue" ? { lt: today } : { gte: today };
  const where: Prisma.VehicleWhereInput = {
    deletedAt: null,
    OR: [{ regoExpiry: range }, { insuranceExpiry: range }, { nextServiceDue: range }],
  };
  const matches = (row: VehicleDueRow & Live) => {
    if (row.deletedAt != null) return false;
    return hasState(vehicleDue(row, ctx), due === "overdue" ? "overdue" : "due-soon");
  };
  return { where, matches };
}

/** Household-wide `?due=` chip counts for Contracts, from the same filters the list uses. */
export async function contractDueCounts(ctx: DueContext): Promise<{ dueSoon: number; overdue: number }> {
  const soon = contractDueFilter("soon", ctx);
  const overdue = contractDueFilter("overdue", ctx);
  const [soonRows, overdueRows] = await Promise.all([
    prisma.contract.findMany({ where: soon.where, select: CONTRACT_DUE_SELECT }),
    prisma.contract.findMany({ where: overdue.where, select: CONTRACT_DUE_SELECT }),
  ]);
  return { dueSoon: soonRows.filter(soon.matches).length, overdue: overdueRows.filter(overdue.matches).length };
}

/** Household-wide `?due=` chip counts for Warranties. */
export async function warrantyDueCounts(ctx: DueContext): Promise<{ dueSoon: number; overdue: number }> {
  const soon = warrantyDueFilter("soon", ctx);
  const lapsed = warrantyDueFilter("overdue", ctx);
  const [soonRows, lapsedRows] = await Promise.all([
    prisma.product.findMany({ where: soon.where, select: WARRANTY_DUE_SELECT }),
    prisma.product.findMany({ where: lapsed.where, select: WARRANTY_DUE_SELECT }),
  ]);
  return { dueSoon: soonRows.filter(soon.matches).length, overdue: lapsedRows.filter(lapsed.matches).length };
}
