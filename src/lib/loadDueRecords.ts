// #674 — the one place that loads the household's Due records (ADR 0002).
//
// Every server caller that needs to know what is Due (the Reminder
// scheduler, Reminder health, the test Reminder, and in later steps the
// dashboard, Search, Upcoming, iCal and MCP) asks this module instead of
// writing its own query. It owns everything that used to be repeated per
// caller: the rough query, the Covers relations, picking a Property's current
// Tenancy, the module gates (Vehicles, Home), the Trash and Archived filters,
// and turning each row into a Due record for the policy.
//
// The queries only narrow. The Due policy decides: a candidate can come back
// with no Due entries (a Contract with no end date, a Vehicle with no dates
// inside its window), and callers filter on `entries`. Contracts are not
// narrowed by end date, so a Contract whose only Due entry has no end date
// behind it (a Cost review, ADR 0005) is never dropped here.
//
// Server-only: it reads the database. The pure Due record builders it uses
// stay in dueRecords.ts, which the list cards import on the client.

import type { Contract, Product, Prisma, Vehicle } from "@/generated/prisma/client";
import { getDueContext } from "@/lib/appSettings";
import { COVERING_CONTRACTS } from "@/lib/covers";
import { dueEntries, type DueContext, type DueEntry } from "@/lib/duePolicy";
import {
  currentTenancy,
  LIVE_TENANCY_AGREEMENTS,
  TENANCY_AGREEMENT_SELECT,
  tenancyDueRecord,
  vehicleDueRecord,
} from "@/lib/dueRecords";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import type { PlannedRecord } from "@/lib/notifications/reminderSchedule";
import { prisma } from "@/lib/prisma";

export type DueRecordKind = "contract" | "warranty" | "vehicle" | "tenancy";

/** The rows behind each kind of Due record. One fixed shape per kind; callers can't pick their own. */
export type DueVehicleRow = Vehicle & { contracts: Prisma.ContractGetPayload<{ select: typeof COVERING_CONTRACTS.select }>[] };
export type DueTenancyRow = Prisma.RentalAgreementGetPayload<{ select: typeof TENANCY_AGREEMENT_SELECT }>;
export interface DueTenancy {
  propertyId: string;
  propertyLabel: string;
  tenancy: DueTenancyRow;
}

interface Loaded<K extends DueRecordKind, O extends string, R> {
  kind: K;
  /** The Reminder log's owner type for this record. */
  ownerType: O;
  /** The owner id the Reminder log uses (a Tenancy's id, not its Property's). */
  id: string;
  row: R;
  /** What the Due policy and the Reminder schedule read, Snooze and Needs review included. */
  record: PlannedRecord;
  /** The record's Due entries for the loaded context, most pressing first. */
  entries: DueEntry[];
}

export type LoadedDueRecord =
  | Loaded<"contract", "CONTRACT", Contract>
  | Loaded<"warranty", "PRODUCT", Product>
  | Loaded<"vehicle", "VEHICLE", DueVehicleRow>
  | Loaded<"tenancy", "TENANCY", DueTenancy>;

export interface DueRecords {
  context: DueContext;
  records: LoadedDueRecord[];
}

export interface LoadDueRecordsOptions {
  /** The household's today and default thresholds. Defaults to `getDueContext()`; tests pass their own. */
  context?: DueContext;
  /** Only these kinds. Defaults to every kind. */
  kinds?: readonly DueRecordKind[];
}

const ALL_KINDS: readonly DueRecordKind[] = ["contract", "warranty", "vehicle", "tenancy"];

const VEHICLE_HAS_A_DATE = {
  OR: [{ regoExpiry: { not: null } }, { insuranceExpiry: { not: null } }, { nextServiceDue: { not: null } }],
} satisfies Prisma.VehicleWhereInput;

const RENTED_PROPERTY_SELECT = {
  id: true,
  label: true,
  isRented: true,
  archivedAt: true,
  rentalAgreements: LIVE_TENANCY_AGREEMENTS,
} as const satisfies Prisma.PropertySelect;

function contractRecord(row: Contract, ctx: DueContext): LoadedDueRecord {
  const record: PlannedRecord = { kind: "contract", ...row };
  return { kind: "contract", ownerType: "CONTRACT", id: row.id, row, record, entries: dueEntries(record, ctx) };
}

function warrantyRecord(row: Product, ctx: DueContext): LoadedDueRecord {
  const record: PlannedRecord = { kind: "warranty", ...row };
  return { kind: "warranty", ownerType: "PRODUCT", id: row.id, row, record, entries: dueEntries(record, ctx) };
}

function vehicleRecord(row: DueVehicleRow, ctx: DueContext): LoadedDueRecord {
  const record: PlannedRecord = vehicleDueRecord(row);
  return { kind: "vehicle", ownerType: "VEHICLE", id: row.id, row, record, entries: dueEntries(record, ctx) };
}

function tenancyRecord(row: DueTenancy, ctx: DueContext): LoadedDueRecord {
  const record: PlannedRecord = tenancyDueRecord(row.tenancy);
  return { kind: "tenancy", ownerType: "TENANCY", id: row.tenancy.id, row, record, entries: dueEntries(record, ctx) };
}

/** Each rented Property's current Tenancy that has a lease end; history and Archived Properties never count. */
async function currentTenancies(where: Prisma.PropertyWhereInput): Promise<DueTenancy[]> {
  const properties = await prisma.property.findMany({
    where: { ...where, deletedAt: null, archivedAt: null, isRented: true },
    select: RENTED_PROPERTY_SELECT,
  });
  return properties.flatMap((property) => {
    const tenancy = currentTenancy(property);
    return tenancy?.leaseEnd ? [{ propertyId: property.id, propertyLabel: property.label, tenancy }] : [];
  });
}

/**
 * Every Due record in the household: Contracts that aren't Cancelled,
 * Warranties with an end date, Vehicles with a date, and each rented
 * Property's current Tenancy. Nothing in Trash; no Archived Vehicle or
 * Property; no Vehicles while the Vehicles module is off, and no Tenancies
 * while Home is off.
 */
export async function loadDueRecords(options: LoadDueRecordsOptions = {}): Promise<DueRecords> {
  const kinds = new Set(options.kinds ?? ALL_KINDS);
  const [context, modules] = await Promise.all([options.context ?? getDueContext(), getEnabledModuleKeys()]);

  const [contracts, products, vehicles, tenancies] = await Promise.all([
    kinds.has("contract")
      ? prisma.contract.findMany({ where: { deletedAt: null, status: { not: "CANCELLED" } } })
      : [],
    kinds.has("warranty")
      ? prisma.product.findMany({ where: { deletedAt: null, warrantyEndDate: { not: null } } })
      : [],
    kinds.has("vehicle") && modules.has("VEHICLES")
      ? prisma.vehicle.findMany({
          where: { deletedAt: null, archivedAt: null, ...VEHICLE_HAS_A_DATE },
          include: { contracts: COVERING_CONTRACTS },
        })
      : [],
    kinds.has("tenancy") && modules.has("HOME") ? currentTenancies({}) : [],
  ]);

  return {
    context,
    records: [
      ...contracts.map((row) => contractRecord(row, context)),
      ...products.map((row) => warrantyRecord(row, context)),
      ...vehicles.map((row) => vehicleRecord(row, context)),
      ...tenancies.map((row) => tenancyRecord(row, context)),
    ],
  };
}

/**
 * One record by kind and id, for a page or action about that record. Null
 * when it doesn't exist, is in Trash, or its module is off. Unlike
 * `loadDueRecords` it returns a Cancelled Contract or an Archived Vehicle,
 * which simply has no Due entries. A Tenancy counts only while it is its
 * Property's current one with a lease end; an older lease is history and
 * comes back null.
 */
export async function loadDueRecord(
  owner: { kind: DueRecordKind; id: string },
  options: Pick<LoadDueRecordsOptions, "context"> = {},
): Promise<{ context: DueContext; record: LoadedDueRecord | null }> {
  const [context, modules] = await Promise.all([options.context ?? getDueContext(), getEnabledModuleKeys()]);
  const found = async (): Promise<LoadedDueRecord | null> => {
    switch (owner.kind) {
      case "contract": {
        const row = await prisma.contract.findFirst({ where: { id: owner.id, deletedAt: null } });
        return row && contractRecord(row, context);
      }
      case "warranty": {
        const row = await prisma.product.findFirst({ where: { id: owner.id, deletedAt: null } });
        return row && warrantyRecord(row, context);
      }
      case "vehicle": {
        if (!modules.has("VEHICLES")) return null;
        const row = await prisma.vehicle.findFirst({
          where: { id: owner.id, deletedAt: null },
          include: { contracts: COVERING_CONTRACTS },
        });
        return row && vehicleRecord(row, context);
      }
      case "tenancy": {
        if (!modules.has("HOME")) return null;
        const agreement = await prisma.rentalAgreement.findFirst({
          where: { id: owner.id, deletedAt: null },
          select: { propertyId: true },
        });
        if (!agreement) return null;
        const [current] = await currentTenancies({ id: agreement.propertyId });
        return current?.tenancy.id === owner.id ? tenancyRecord(current, context) : null;
      }
    }
  };
  return { context, record: await found() };
}
