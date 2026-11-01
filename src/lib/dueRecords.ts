// #384 — the thin layer between the app's rows and the Due policy
// (duePolicy.ts, ADR 0002). Every screen that shows whether something is
// Due — the lists and their cards, the dashboard and Needs attention,
// Search, Upcoming, iCal and the detail-page banners — turns its row into a
// Due record here and asks the policy, so the same record reads the same
// everywhere. Nothing here decides Due itself: it only picks which of the
// policy's entries a screen shows.
//
// Pure and free of runtime imports beyond the policy, so client components
// (the list cards) can use it with a DueContext handed down from the server.

import { dueEntries, isDue, type DateInput, type DueContext, type DueEntry, type DueState } from "@/lib/duePolicy";

export type { DueContext, DueEntry, DueState };

export interface ContractDueRow {
  endDate: DateInput;
  noticePeriodDays: number | null;
  renewalType: string;
  status: string;
  reminderDaysBefore?: string | null;
}

export interface WarrantyDueRow {
  warrantyEndDate: DateInput;
  reminderDaysBefore?: string | null;
}

export interface VehicleDueRow {
  regoExpiry: DateInput;
  insuranceExpiry: DateInput;
  nextServiceDue: DateInput;
  reminderDaysBefore?: string | null;
  /**
   * #355 — an Archived Vehicle has no Due entries. Required, not optional,
   * so a query that forgets to select it fails to type-check instead of
   * quietly bringing a sold Vehicle's dates back.
   */
  archivedAt: DateInput;
}

export interface TenancyDueRow {
  leaseEnd: DateInput;
  reminderDaysBefore?: string | null;
}

export function contractDue(row: ContractDueRow, ctx: DueContext): DueEntry[] {
  return dueEntries(
    {
      kind: "contract",
      endDate: row.endDate,
      noticePeriodDays: row.noticePeriodDays,
      renewalType: row.renewalType,
      status: row.status,
      reminderDaysBefore: row.reminderDaysBefore,
    },
    ctx,
  );
}

export function warrantyDue(row: WarrantyDueRow, ctx: DueContext): DueEntry[] {
  return dueEntries(
    { kind: "warranty", warrantyEndDate: row.warrantyEndDate, reminderDaysBefore: row.reminderDaysBefore },
    ctx,
  );
}

export function vehicleDue(row: VehicleDueRow, ctx: DueContext): DueEntry[] {
  return dueEntries(
    {
      kind: "vehicle",
      regoExpiry: row.regoExpiry,
      insuranceExpiry: row.insuranceExpiry,
      nextServiceDue: row.nextServiceDue,
      reminderDaysBefore: row.reminderDaysBefore,
      archivedAt: row.archivedAt,
    },
    ctx,
  );
}

export function tenancyDue(row: TenancyDueRow, ctx: DueContext): DueEntry[] {
  return dueEntries({ kind: "tenancy", leaseEnd: row.leaseEnd, reminderDaysBefore: row.reminderDaysBefore }, ctx);
}

/**
 * The entry a one-badge record shows: a Contract or Warranty has at most
 * one at a time, and the policy sorts the most pressing first.
 */
export function headlineEntry(entries: DueEntry[]): DueEntry | null {
  return entries[0] ?? null;
}

/**
 * The entries a detail page's banner calls out: Due ones (due soon or
 * overdue), and the Housekeeping one of a record waiting on its new end
 * date. Later, Ended and Lapsed entries only show as the badge.
 */
export function bannerEntries(entries: DueEntry[]): DueEntry[] {
  return entries.filter((entry) => isDue(entry) || entry.state === "needs-new-end-date");
}

/**
 * #405 — whether a detail page's status banner already states the headline
 * entry, so the header badge beside it ("10d left" next to "Expires in 10
 * days") would only repeat it.
 */
export function bannerRepeatsBadge(headline: DueEntry | null, entries: DueEntry[]): boolean {
  if (!headline) return false;
  return bannerEntries(entries).some((e) => e.field === headline.field && e.date === headline.date);
}

type TenancyAgreement = { leaseStart: Date | null; leaseEnd: Date | null; createdAt: Date; deletedAt: Date | null };

// Missing dates sort before any real one.
const time = (date: Date | null) => (date ? date.getTime() : Number.NEGATIVE_INFINITY);

/** Positive when `a` is the more recent lease: latest start, then latest end, then latest entered. */
function compareLeases(a: TenancyAgreement, b: TenancyAgreement): number {
  return (
    time(a.leaseStart) - time(b.leaseStart) ||
    time(a.leaseEnd) - time(b.leaseEnd) ||
    a.createdAt.getTime() - b.createdAt.getTime()
  );
}

/**
 * A Property's current Tenancy: its most recent lease, while rental
 * tracking is on. Most recent means the latest lease start, then the latest
 * lease end, and only then the latest entered, so back-entering an old
 * lease never displaces the running one. Older agreements are history, so
 * their lease ends are never Due. An Archived Property (the household no
 * longer has it) has none either.
 */
export function currentTenancy<T extends TenancyAgreement>(property: {
  isRented: boolean;
  /** Required so no caller can forget it: an Archived Property has no current Tenancy (#355). */
  archivedAt: Date | null;
  rentalAgreements: T[];
}): T | null {
  if (property.archivedAt != null) return null;
  // A Tenancy in Trash is never current (#427), whether or not the caller's
  // query already left it out: its lease end isn't Due, on Upcoming or
  // iCal, and gets no Reminders.
  const live = property.rentalAgreements.filter((a) => a.deletedAt == null);
  if (!property.isRented || live.length === 0) return null;
  return live.reduce((current, a) => (compareLeases(a, current) > 0 ? a : current));
}

/** The rental agreement fields `currentTenancy` and the Due policy need, for a Prisma `select`. */
export const TENANCY_AGREEMENT_SELECT = {
  id: true,
  tenantName: true,
  leaseStart: true,
  leaseEnd: true,
  reminderDaysBefore: true,
  createdAt: true,
  deletedAt: true,
} as const;

/**
 * A Property's `rentalAgreements` relation for currentTenancy: the Tenancies
 * not in Trash, with the fields it needs. Every caller uses this, so none
 * can forget the Trash filter (currentTenancy also skips any in Trash).
 */
export const LIVE_TENANCY_AGREEMENTS = {
  where: { deletedAt: null },
  select: TENANCY_AGREEMENT_SELECT,
} as const;
