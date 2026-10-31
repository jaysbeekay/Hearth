// #395/#384 — what `?due=soon` / `?due=overdue` / `?due=lapsed` select on the
// Contracts and Warranties lists, their chip counts, and Search's same filters. The Due
// policy decides (ADR 0002): each filter is a rough `where` that only
// narrows candidates, plus the in-memory `matches` that asks the policy.
// Don't tighten the `where` into exact SQL; that's how lists and Search
// came to disagree.
//
// - `soon`: an entry is due soon, inside the record's own due-soon window.
// - `overdue`: on Contracts, an Expired (manual-renewal) one. Ended and
//   auto-renewing Contracts are never overdue. On Vehicles, any date that
//   has passed. A Warranty is never overdue, so it selects none.
// - `lapsed`: Warranties past their end date, for the list's "Lapsed" chip.
//   Lapsed is not a Due state (GLOSSARY.md), so it isn't spelled `overdue`;
//   only Warranties lapse, so it selects nothing else.
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { COVERING_CONTRACTS } from "@/lib/covers";
import type { CalendarDay, DueContext, DueEntry, DueState } from "@/lib/duePolicy";
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
  archivedAt: true,
  regoExpiry: true,
  insuranceExpiry: true,
  nextServiceDue: true,
  reminderDaysBefore: true,
  contracts: COVERING_CONTRACTS,
} as const satisfies Prisma.VehicleSelect;

type Live = { deletedAt: Date | null };

/**
 * The state a `?due=` value selects on each kind of record, or null when it
 * can select nothing there: only Warranties are ever Lapsed, and a Warranty
 * is never overdue (it lapses instead).
 */
function selectedState(kind: "contract" | "warranty" | "vehicle", due: DueFilter): DueState | null {
  switch (due) {
    case "soon":
      return "due-soon";
    case "overdue":
      return kind === "warranty" ? null : "overdue";
    case "lapsed":
      return kind === "warranty" ? "lapsed" : null;
  }
}

/** Matches no row: for a `?due=` value that selects nothing on this record type. */
const NO_ROWS = { id: { in: [] as string[] } };

/** Overdue and Lapsed dates have passed; due-soon ones are today or later. */
function dateRange(state: DueState, today: Date) {
  return state === "due-soon" ? { gte: today } : { lt: today };
}

export function contractDueFilter(due: DueFilter, ctx: DueContext) {
  const state = selectedState("contract", due);
  // A notice deadline is before its end date, so anything due soon still
  // has an end date of today or later.
  const where: Prisma.ContractWhereInput = state
    ? { deletedAt: null, status: { not: "CANCELLED" }, endDate: dateRange(state, dayStart(ctx.today)) }
    : NO_ROWS;
  const matches = (row: ContractDueRow & Live) =>
    state != null && row.deletedAt == null && hasState(contractDue(row, ctx), state);
  return { where, matches };
}

export function warrantyDueFilter(due: DueFilter, ctx: DueContext) {
  const state = selectedState("warranty", due);
  const where: Prisma.ProductWhereInput = state
    ? { deletedAt: null, warrantyEndDate: dateRange(state, dayStart(ctx.today)) }
    : NO_ROWS;
  const matches = (row: WarrantyDueRow & Live) =>
    state != null && row.deletedAt == null && hasState(warrantyDue(row, ctx), state);
  return { where, matches };
}

export function vehicleDueFilter(due: DueFilter, ctx: DueContext) {
  const state = selectedState("vehicle", due);
  const range = state ? dateRange(state, dayStart(ctx.today)) : null;
  const where: Prisma.VehicleWhereInput = range
    ? { deletedAt: null, archivedAt: null, OR: [{ regoExpiry: range }, { insuranceExpiry: range }, { nextServiceDue: range }] }
    : NO_ROWS;
  const matches = (row: VehicleDueRow & Live) =>
    state != null && row.deletedAt == null && hasState(vehicleDue(row, ctx), state);
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

/** Household-wide `?due=` chip counts for Warranties: due soon, and Lapsed. */
export async function warrantyDueCounts(ctx: DueContext): Promise<{ dueSoon: number; lapsed: number }> {
  const soon = warrantyDueFilter("soon", ctx);
  const lapsed = warrantyDueFilter("lapsed", ctx);
  const [soonRows, lapsedRows] = await Promise.all([
    prisma.product.findMany({ where: soon.where, select: WARRANTY_DUE_SELECT }),
    prisma.product.findMany({ where: lapsed.where, select: WARRANTY_DUE_SELECT }),
  ]);
  return { dueSoon: soonRows.filter(soon.matches).length, lapsed: lapsedRows.filter(lapsed.matches).length };
}
