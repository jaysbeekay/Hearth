// Covers (#456, glossary): the narrow case of Linked to where a Contract's
// end date *is* the Vehicle's expiry. A Covering Contract supplies the
// Vehicle's date and the Vehicle's own Due entry for that field is switched
// off (`coveredFields` in the Due policy), so there is one Reminder stream.
//
// A Contract Covers a Vehicle when it is
//   - linked to the Vehicle (`vehicleId`),
//   - in a Covering Category: CAR_INSURANCE covers `insuranceExpiry`,
//     REGISTRATION covers `regoExpiry`,
//   - not Cancelled, not in Trash and not awaiting review (an unconfirmed
//     extraction must not take over a date the household typed in), and
//   - has an end date (without one it supplies nothing, so the manual date stays).
// A fixed-term Contract that has passed its end date still supplies the date,
// but it has simply ended (never Due), so the Vehicle's Due entry for that
// date comes back as Overdue from the Contract's end date (`fixedTermCoverEnds`
// in the Due policy) instead of the lapse going unannounced. An auto-renewing
// Contract past its end carries on, and its own "needs a new end date"
// Housekeeping stands in.
// When several Contracts Cover the same field, the one ending last wins (a
// renewal added before the old policy ran out); ties go to the one entered
// last, and the others keep their own Reminders. When the Covering Contract is cancelled, trashed, unlinked,
// re-categorised or loses its end date, the Vehicle's own manual date takes
// over again: nothing is ever written to the Vehicle, so nothing is lost.
//
// Pure and free of runtime imports, so server, client and vitest can all use
// it. The standalone shell keeps a hand-ported copy (ios-shell/www/app.js).

import type { ContractCategory } from "@/generated/prisma/enums";
import { calendarDayOf, type CalendarDay, type VehicleDueField } from "@/lib/duePolicy";

type CoverableField = Extract<VehicleDueField, "regoExpiry" | "insuranceExpiry">;

/** Which Vehicle date each Covering Category supplies. */
const COVERED_FIELD = new Map<string, CoverableField>([
  ["CAR_INSURANCE", "insuranceExpiry"],
  ["REGISTRATION", "regoExpiry"],
]);

export const COVERING_CATEGORIES: ContractCategory[] = ["CAR_INSURANCE", "REGISTRATION"];

/** The Vehicle date a Contract Category Covers, or null for a Category that doesn't. */
export function coveredFieldOf(category: string): CoverableField | null {
  return COVERED_FIELD.get(category) ?? null;
}

/** The Contract fields the rule needs. */
export interface CoveringContractRow {
  id: string;
  title: string;
  provider: string;
  category: string;
  status: string;
  /** Optional only so older fixtures type-check; COVERING_CONTRACTS selects it. */
  renewalType?: string;
  /** Still awaiting review of its extracted details. */
  extractionPending: boolean;
  endDate: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
}

/**
 * The `contracts` relation to load with a Vehicle, so every caller gets
 * the rows `vehicleCovers` needs. The `where` only narrows; `vehicleCovers`
 * decides.
 */
export const COVERING_CONTRACTS = {
  where: {
    deletedAt: null,
    status: { not: "CANCELLED" as const },
    extractionPending: false,
    endDate: { not: null },
    category: { in: COVERING_CATEGORIES },
  },
  select: {
    id: true,
    title: true,
    provider: true,
    category: true,
    status: true,
    renewalType: true,
    extractionPending: true,
    endDate: true,
    createdAt: true,
    deletedAt: true,
  },
  orderBy: { endDate: "desc" as const },
};

export interface VehicleCover {
  field: CoverableField;
  contract: { id: string; title: string; provider: string };
  /** The Contract's end date: the Vehicle's date while it Covers. */
  date: Date;
  /** How many Contracts Cover this date; the latest-ending one is `contract`. */
  count: number;
  /** The Covering Contract is fixed-term: it ends rather than renews. */
  fixedTerm: boolean;
}

/** Whether a linked Contract Covers its Vehicle's date (see the rule above). */
export function isCovering(contract: CoveringContractRow): boolean {
  return (
    contract.deletedAt == null &&
    contract.status !== "CANCELLED" &&
    !contract.extractionPending &&
    contract.endDate != null &&
    COVERED_FIELD.has(contract.category)
  );
}

// Positive when `a` should win over `b`: later end, then entered later, then id (stable).
function compareCovers(a: CoveringContractRow, b: CoveringContractRow): number {
  return (
    a.endDate!.getTime() - b.endDate!.getTime() ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.id.localeCompare(b.id)
  );
}

/** The covers a Vehicle's linked Contracts give it: at most one per date. */
export function vehicleCovers(contracts: CoveringContractRow[]): VehicleCover[] {
  const winners = new Map<CoverableField, CoveringContractRow>();
  const counts = new Map<CoverableField, number>();
  for (const contract of contracts) {
    if (!isCovering(contract)) continue;
    const field = coveredFieldOf(contract.category)!;
    counts.set(field, (counts.get(field) ?? 0) + 1);
    const current = winners.get(field);
    if (!current || compareCovers(contract, current) > 0) winners.set(field, contract);
  }
  return [...winners].map(([field, c]) => ({
    field,
    contract: { id: c.id, title: c.title, provider: c.provider },
    date: c.endDate!,
    count: counts.get(field) ?? 1,
    fixedTerm: c.renewalType === "FIXED_TERM",
  }));
}

/** The Vehicle dates a set of covers switches off, for the Due policy's `coveredFields`. */
export function coveredFieldsOf(covers: VehicleCover[]): VehicleDueField[] {
  return covers.map((c) => c.field);
}

/** The end dates of fixed-term covers, for the Due policy's `fixedTermCoverEnds`. */
export function fixedTermCoverEndsOf(covers: VehicleCover[]): Partial<Record<VehicleDueField, Date>> {
  return Object.fromEntries(covers.filter((c) => c.fixedTerm).map((c) => [c.field, c.date]));
}

/**
 * A Vehicle with its Covered dates replaced by the Covering Contracts' end
 * dates, for anything that shows the date (detail, card, MCP, iCal). The
 * row's own dates are untouched in the database.
 */
export function withVehicleCovers<
  V extends { regoExpiry: Date | null; insuranceExpiry: Date | null; contracts: CoveringContractRow[] },
>(vehicle: V): V & { covers: VehicleCover[]; coveredFields: VehicleDueField[] } {
  const covers = vehicleCovers(vehicle.contracts);
  const dateFor = (field: CoverableField, own: Date | null) => covers.find((c) => c.field === field)?.date ?? own;
  return {
    ...vehicle,
    regoExpiry: dateFor("regoExpiry", vehicle.regoExpiry),
    insuranceExpiry: dateFor("insuranceExpiry", vehicle.insuranceExpiry),
    covers,
    coveredFields: coveredFieldsOf(covers),
  };
}

const FIELD_NOUN = new Map<CoverableField, string>([
  ["regoExpiry", "rego"],
  ["insuranceExpiry", "insurance"],
]);

/**
 * What to tell someone when a Contract stops Covering a date: the Vehicle's
 * own date applies again, which may be out of date or already past. `formatted`
 * is the manual date in the viewer's format.
 */
export function resumedDateMessage(
  field: CoverableField,
  manual: Date | null,
  today: CalendarDay,
  formatted: string | null,
): string {
  const noun = FIELD_NOUN.get(field) ?? "date";
  const day = calendarDayOf(manual);
  if (!day || !formatted) {
    return `The vehicle has no ${noun} date of its own, so it has no ${noun} reminder until you add one.`;
  }
  const tail = day < today
    ? "That date has already passed, so it will show as overdue until you update it."
    : "Update it if it's out of date.";
  return `The vehicle's own ${noun} date, ${formatted}, will apply again. ${tail}`;
}
