// Shared read-only queries and serializers for the household's records,
// used by both the in-app AI Assistant (src/lib/chat/tools.ts) and the
// external MCP server (src/lib/mcp/server.ts), so the two tool layers are
// thin wrappers that can't drift apart (#394). Net worth doesn't need an
// entry here: it already has one shared implementation in src/lib/wealth.ts.
//
// Nothing here writes, and nothing returns account credentials or document
// file contents: MCP is read-only, and both surfaces hand this output to a
// language model.
//
// Whether anything is Due comes from the Due policy (duePolicy.ts, ADR
// 0002), counted in the household's day: the queries below only narrow
// candidates roughly, then ask the policy.
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { CATEGORY_LABELS, daysUntil, formatPropertyAddress, monthlyEquivalent } from "@/lib/utils";
import { getDueContext, getHouseholdToday } from "@/lib/appSettings";
import { calendarDayOf, isDue, type DueContext, type DueEntry } from "@/lib/duePolicy";
import { contractDue, currentTenancy, tenancyDue, TENANCY_AGREEMENT_SELECT, vehicleDue, warrantyDue } from "@/lib/dueRecords";
import { buildCategoryBreakdown, monthlySpend } from "@/lib/spend";
import { getFxRateMap, refreshFxRates } from "@/lib/fx";
import type { ModuleKey } from "@/lib/modules/registry";
import type { CONTRACT_CATEGORIES, CONTRACT_STATUSES } from "@/lib/validation/contract";

export function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

export async function queryProducts(query?: string) {
  const today = await getHouseholdToday();
  const products = await prisma.product.findMany({
    where: {
      deletedAt: null,
      ...(query
        ? {
            OR: [
              { description: { contains: query } },
              { manufacturer: { contains: query } },
              { model: { contains: query } },
              { vendor: { contains: query } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      description: true,
      manufacturer: true,
      model: true,
      vendor: true,
      purchaseDate: true,
      warrantyEndDate: true,
      price: true,
      currency: true,
      notes: true,
    },
    orderBy: { warrantyEndDate: "asc" },
  });
  return products.map((p) => ({
    ...p,
    purchaseDate: iso(p.purchaseDate),
    warrantyEndDate: iso(p.warrantyEndDate),
    daysUntilWarrantyEnd: daysUntil(p.warrantyEndDate, today),
  }));
}

export async function queryTrips(upcomingOnly?: boolean) {
  const trips = await prisma.trip.findMany({
    where: {
      deletedAt: null,
      ...(upcomingOnly ? { OR: [{ endDate: null }, { endDate: { gte: new Date() } }] } : {}),
    },
    select: {
      id: true,
      title: true,
      destination: true,
      startDate: true,
      endDate: true,
      notes: true,
      _count: { select: { segments: true } },
    },
    orderBy: { startDate: "asc" },
  });
  return trips.map((t) => ({
    id: t.id,
    title: t.title,
    destination: t.destination,
    startDate: iso(t.startDate),
    endDate: iso(t.endDate),
    notes: t.notes,
    segmentCount: t._count.segments,
  }));
}

export async function queryVehicles(attentionOnly?: boolean) {
  const today = await getHouseholdToday();
  const vehicles = await prisma.vehicle.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      label: true,
      make: true,
      model: true,
      year: true,
      licensePlate: true,
      regoExpiry: true,
      insuranceExpiry: true,
      nextServiceDue: true,
      notes: true,
    },
  });
  const withDays = vehicles.map((v) => ({
    ...v,
    regoExpiry: iso(v.regoExpiry),
    insuranceExpiry: iso(v.insuranceExpiry),
    nextServiceDue: iso(v.nextServiceDue),
    daysUntilRegoExpiry: daysUntil(v.regoExpiry, today),
    daysUntilInsuranceExpiry: daysUntil(v.insuranceExpiry, today),
    daysUntilNextServiceDue: daysUntil(v.nextServiceDue, today),
  }));
  if (!attentionOnly) return withDays;
  const needsAttention = (days: number | null) => days != null && days <= 30;
  return withDays.filter(
    (v) => needsAttention(v.daysUntilRegoExpiry) || needsAttention(v.daysUntilInsuranceExpiry),
  );
}

export async function queryProperties() {
  const properties = await prisma.property.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      label: true,
      street: true,
      suburb: true,
      state: true,
      postcode: true,
      country: true,
      isRented: true,
      occupancyStatus: true,
      notes: true,
      rentalAgreements: {
        select: { tenantName: true, weeklyRent: true, leaseEnd: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      valuations: {
        select: { value: true, currency: true, valuedAt: true },
        orderBy: { valuedAt: "desc" },
        take: 1,
      },
    },
  });
  return properties.map((p) => ({
    id: p.id,
    label: p.label,
    address: formatPropertyAddress(p) || null,
    isRented: p.isRented,
    occupancyStatus: p.occupancyStatus,
    notes: p.notes,
    currentTenant: p.rentalAgreements[0]
      ? {
          tenantName: p.rentalAgreements[0].tenantName,
          weeklyRent: p.rentalAgreements[0].weeklyRent,
          leaseEnd: iso(p.rentalAgreements[0].leaseEnd),
        }
      : null,
    latestValuation: p.valuations[0]
      ? {
          value: p.valuations[0].value,
          currency: p.valuations[0].currency,
          valuedAt: iso(p.valuations[0].valuedAt),
        }
      : null,
  }));
}

export async function queryInventoryItems(query?: string) {
  const items = await prisma.inventoryItem.findMany({
    where: {
      deletedAt: null,
      ...(query
        ? {
            OR: [
              { label: { contains: query } },
              { brand: { contains: query } },
              { model: { contains: query } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      label: true,
      category: true,
      brand: true,
      model: true,
      purchaseDate: true,
      purchasePrice: true,
      currency: true,
      location: true,
      notes: true,
    },
  });
  return items.map((i) => ({ ...i, purchaseDate: iso(i.purchaseDate) }));
}

// ─── Contracts ────────────────────────────────────────────────────────────────
// One field allowlist and one serializer for MCP and the Assistant (#394).
// Household-wide, with no createdById filter: everyone in the household sees
// the same Contracts (CLAUDE.md). Credentials and document bytes never
// appear; getContract lists document metadata only.

const CONTRACT_SELECT = {
  id: true,
  title: true,
  category: true,
  provider: true,
  contractNumber: true,
  startDate: true,
  endDate: true,
  renewalType: true,
  noticePeriodDays: true,
  cost: true,
  currency: true,
  billingFrequency: true,
  status: true,
  contactName: true,
  contactPhone: true,
  contactEmail: true,
  notes: true,
  isTaxDeductible: true,
  reminderDaysBefore: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** How many days ahead the Due tools look when not told. */
export const DEFAULT_DUE_HORIZON_DAYS = 30;

export interface DueEntryJson {
  field: DueEntry["field"];
  date: string;
  daysLeft: number;
  state: DueEntry["state"];
  label: string;
}

function dueEntryJson(entry: DueEntry): DueEntryJson {
  return { field: entry.field, date: entry.date, daysLeft: entry.daysLeft, state: entry.state, label: entry.label };
}

interface ContractRow {
  startDate: Date | null;
  endDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  cost: number | null;
  billingFrequency: string | null;
  noticePeriodDays: number | null;
  renewalType: string;
  status: string;
  reminderDaysBefore: string | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * A Contract as both tools return it: its fields, its Due entries from the
 * Due policy (`due`, soonest first), and `state`, the most pressing entry's
 * state (null when it has none: Cancelled, or no end date).
 */
export function serializeContract<T extends ContractRow>(contract: T, ctx: DueContext) {
  const entries = contractDue(contract, ctx);
  return {
    ...contract,
    // Calendar dates as their day (YYYY-MM-DD), like the Due entries;
    // createdAt and updatedAt are moments, so they stay full timestamps.
    startDate: calendarDayOf(contract.startDate),
    endDate: calendarDayOf(contract.endDate),
    createdAt: contract.createdAt.toISOString(),
    updatedAt: contract.updatedAt.toISOString(),
    state: entries[0]?.state ?? null,
    due: entries.map(dueEntryJson),
    // In the Contract's own currency; spendSummary converts.
    estimatedMonthlySpend: round2(monthlyEquivalent(contract.cost, contract.billingFrequency)),
  };
}

export interface ContractFilters {
  status?: (typeof CONTRACT_STATUSES)[number];
  category?: (typeof CONTRACT_CATEGORIES)[number];
}

export async function queryContracts(filters: ContractFilters = {}) {
  const { status, category } = filters;
  const [ctx, contracts] = await Promise.all([
    getDueContext(),
    prisma.contract.findMany({
      where: { deletedAt: null, ...(status && { status }), ...(category && { category }) },
      select: CONTRACT_SELECT,
      orderBy: { endDate: "asc" },
    }),
  ]);
  return contracts.map((c) => serializeContract(c, ctx));
}

/** One Contract with its documents' metadata (never file contents), or null when there's none with that id. */
export async function getContract(id: string) {
  const [ctx, contract] = await Promise.all([
    getDueContext(),
    prisma.contract.findFirst({
      where: { id, deletedAt: null },
      select: {
        ...CONTRACT_SELECT,
        documents: {
          where: { deletedAt: null },
          select: { id: true, filename: true, mimeType: true, size: true, uploadedAt: true },
          orderBy: { uploadedAt: "asc" },
        },
      },
    }),
  ]);
  if (!contract) return null;
  const { documents, ...fields } = contract;
  return {
    ...serializeContract(fields, ctx),
    documents: documents.map((doc) => ({ ...doc, uploadedAt: doc.uploadedAt.toISOString() })),
  };
}

export async function searchContracts(query: string) {
  const [ctx, contracts] = await Promise.all([
    getDueContext(),
    prisma.contract.findMany({
      where: {
        deletedAt: null,
        OR: [
          { title: { contains: query } },
          { provider: { contains: query } },
          { contractNumber: { contains: query } },
          { notes: { contains: query } },
        ],
      },
      select: CONTRACT_SELECT,
      orderBy: { endDate: "asc" },
    }),
  ]);
  return contracts.map((c) => serializeContract(c, ctx));
}

/**
 * The saved title and dates of a Contract the Assistant proposes to change,
 * for its confirmation card and date-order check; null when there's none
 * with that id. Read-only.
 */
export async function contractProposalBasis(id: string) {
  return prisma.contract.findFirst({
    where: { id, deletedAt: null },
    // The current links too: the proposal only checks links it newly sets (#447).
    select: { title: true, startDate: true, endDate: true, propertyId: true, vehicleId: true },
  });
}

/**
 * Whether an entry is Due (due soon or overdue) and dated within the next
 * `horizon` days. Overdue entries count: an Expired Contract stays Due
 * until renewed or Cancelled. This is whats_due's rule.
 */
function dueWithin(entry: DueEntry, horizon: number): boolean {
  return entry.daysLeft <= horizon && isDue(entry);
}

/**
 * Whether a Contract's entry is dated within the next `horizon` days and
 * still something to act on or know about: Due, or `later` (outside its
 * due-soon window, or an auto-renewing Contract's renewal date). Ended
 * entries are never Due, and one waiting on its new end date is
 * Housekeeping, so those are left out. This is upcoming_renewals' rule.
 */
function datedWithin(entry: DueEntry, horizon: number): boolean {
  return entry.daysLeft <= horizon && (isDue(entry) || entry.state === "later");
}

/**
 * Contracts with an entry dated within `withinDays` days, soonest first:
 * the notice deadline while it's ahead, then the end date (Due policy).
 */
export async function upcomingRenewals(withinDays: number = DEFAULT_DUE_HORIZON_DAYS) {
  const [ctx, contracts] = await Promise.all([
    getDueContext(),
    // Rough narrowing only (ADR 0002): the policy decides.
    prisma.contract.findMany({
      where: { deletedAt: null, status: { not: "CANCELLED" }, endDate: { not: null } },
      select: CONTRACT_SELECT,
    }),
  ]);
  const upcoming: { daysLeft: number; contract: ReturnType<typeof serializeContract<(typeof contracts)[number]>> }[] = [];
  for (const row of contracts) {
    const entry = contractDue(row, ctx).find((e) => datedWithin(e, withinDays));
    if (entry) upcoming.push({ daysLeft: entry.daysLeft, contract: serializeContract(row, ctx) });
  }
  return upcoming
    .sort((a, b) => a.daysLeft - b.daysLeft || a.contract.title.localeCompare(b.contract.title))
    .map((u) => u.contract);
}

const CATEGORY_LABEL_MAP = new Map(Object.entries(CATEGORY_LABELS));

/**
 * The currency spendSummary converts to when none is asked for: the asking
 * member's preferred currency, or for MCP (which has no member) the first
 * admin's, as the household's.
 */
export async function defaultSpendCurrency(userId?: string): Promise<string> {
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId }, select: { preferredCurrency: true } })
    : await prisma.user.findFirst({
        where: { role: "ADMIN" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { preferredCurrency: true },
      });
  return user?.preferredCurrency || "AUD";
}

const CURRENCY_CODES: ReadonlySet<string> = new Set(Intl.supportedValuesOf("currency"));

/** Whether `code` is an ISO 4217 currency code this runtime knows, in any case ("aud" counts). */
export function isCurrencyCode(code: string): boolean {
  return CURRENCY_CODES.has(code.toUpperCase());
}

/** spend_summary's `currency` input, on both surfaces. */
export const currencyCodeSchema = z
  .string()
  .refine(isCurrencyCode, { message: "Must be an ISO 4217 currency code, such as AUD or USD." });

/**
 * Monthly spend across active Contracts, converted to `currency` exactly as
 * the dashboard and the Spending page do (monthlySpend and
 * buildCategoryBreakdown), so all of them give the same figure. One-off
 * charges have no monthly equivalent and count as nothing. Currencies with
 * no exchange rate right now are left out of the totals and listed.
 */
export async function spendSummary(currency: string) {
  const target = currency.toUpperCase();
  const active = await prisma.contract.findMany({
    where: { status: "ACTIVE", deletedAt: null },
    select: { category: true, cost: true, currency: true, billingFrequency: true },
  });
  const pairs = [...new Set(active.map((c) => c.currency))].map((from) => ({ from, to: target }));
  await refreshFxRates(pairs);
  const rateMap = await getFxRateMap(pairs);
  const { total, unconvertedCurrencies } = monthlySpend(active, target, rateMap);
  const breakdown = buildCategoryBreakdown(active, target, rateMap);
  return {
    currency: target,
    estimatedMonthlySpendTotal: round2(total),
    byCategory: Object.fromEntries(
      breakdown.map((b) => [CATEGORY_LABEL_MAP.get(b.category) ?? b.category, round2(b.monthlyTotal)]),
    ),
    unconvertedCurrencies,
  };
}

// ─── What's due ───────────────────────────────────────────────────────────────

export type DueItemKind = "contract" | "warranty" | "vehicle" | "tenancy";

export interface DueItem extends DueEntryJson {
  kind: DueItemKind;
  /** The record's id: the Contract, the Item's product, the Vehicle, or the Tenancy's Property. */
  id: string;
  title: string;
}

/**
 * Every Due entry within `withinDays` days across the household, soonest
 * first: Contracts and Warranties always, Vehicle dates while Vehicles is
 * enabled and Tenancy lease ends while Home is, each with the state the Due
 * policy gives it (the same as Needs attention).
 */
export async function whatsDue(enabledModules: Set<ModuleKey>, withinDays: number = DEFAULT_DUE_HORIZON_DAYS) {
  const [ctx, contracts, products, vehicles, properties] = await Promise.all([
    getDueContext(),
    prisma.contract.findMany({
      where: { deletedAt: null, status: { not: "CANCELLED" }, endDate: { not: null } },
      select: {
        id: true,
        title: true,
        endDate: true,
        noticePeriodDays: true,
        renewalType: true,
        status: true,
        reminderDaysBefore: true,
      },
    }),
    prisma.product.findMany({
      where: { deletedAt: null, warrantyEndDate: { not: null } },
      select: { id: true, description: true, warrantyEndDate: true, reminderDaysBefore: true },
    }),
    enabledModules.has("VEHICLES")
      ? prisma.vehicle.findMany({
          where: { deletedAt: null },
          select: {
            id: true,
            label: true,
            regoExpiry: true,
            insuranceExpiry: true,
            nextServiceDue: true,
            reminderDaysBefore: true,
          },
        })
      : [],
    enabledModules.has("HOME")
      ? prisma.property.findMany({
          where: { deletedAt: null, isRented: true },
          select: { id: true, label: true, isRented: true, rentalAgreements: { select: TENANCY_AGREEMENT_SELECT } },
        })
      : [],
  ]);

  const items: DueItem[] = [];
  const add = (kind: DueItemKind, id: string, title: string, entries: DueEntry[]) => {
    for (const entry of entries) {
      if (dueWithin(entry, withinDays)) items.push({ kind, id, title, ...dueEntryJson(entry) });
    }
  };
  for (const c of contracts) add("contract", c.id, c.title, contractDue(c, ctx));
  for (const p of products) add("warranty", p.id, p.description, warrantyDue(p, ctx));
  for (const v of vehicles) add("vehicle", v.id, v.label, vehicleDue(v, ctx));
  for (const property of properties) {
    const tenancy = currentTenancy(property);
    if (tenancy) add("tenancy", property.id, property.label, tenancyDue(tenancy, ctx));
  }
  return items.sort(
    (a, b) => a.daysLeft - b.daysLeft || a.title.localeCompare(b.title) || a.field.localeCompare(b.field),
  );
}

// ─── Tool descriptions ────────────────────────────────────────────────────────
// Shared by MCP and the Assistant, in the glossary's terms (GLOSSARY.md).

const CONTRACT_SHAPE =
  "Each Contract has its fields (contacts and isTaxDeductible included; never credentials; " +
  "startDate and endDate as calendar days, YYYY-MM-DD), " +
  "`due`: its Due entries from the household's Due policy (field, date, daysLeft, state, label), " +
  "and `state`, its most pressing entry's state. States: later, due-soon, overdue (an Expired " +
  "manual-renewal Contract, still Due until renewed or Cancelled), ended (a fixed-term Contract " +
  "past its end date; never Due), needs-new-end-date (an auto-renewing Contract past its end date, " +
  "which carried on into its next Term). A Cancelled Contract has no Due entries.";

export const TOOL_DESCRIPTIONS = {
  listContracts:
    "List the household's Contracts (insurance, phone plans, leases, loans, subscriptions, utilities " +
    `and so on), optionally filtered by status and/or category. ${CONTRACT_SHAPE}`,
  getContract:
    "Get one Contract by id, with the same shape as list_contracts plus its documents' metadata " +
    "(filename, type, size; never file contents).",
  searchContracts: `Case-insensitive search of Contracts across title, provider, contract number and notes. ${CONTRACT_SHAPE}`,
  upcomingRenewals:
    "Contracts with a renewal-related date within N days (default 30), soonest first: the notice deadline " +
    "(the last day to tell the provider you won't renew) while that is ahead, then the end date. Check " +
    "each entry's state: due-soon and overdue entries are Due (an Expired Contract is overdue); an entry " +
    "in state later is not Due, either because it is outside its due-soon window or because it is an " +
    "auto-renewing Contract's renewal date, which needs no action. Ended and Cancelled Contracts, and " +
    "auto-renewing ones waiting on their new end date, are left out. Same Contract shape as list_contracts.",
  spendSummary:
    "Estimated monthly spend across active Contracts, total and per category, converted to one " +
    "currency the same way as the dashboard and the Spending page (default: the preferred currency). " +
    "One-off charges and categories with no monthly spend are left out. May fetch current exchange " +
    "rates. Currencies with no exchange rate right now are left out of the totals and listed in " +
    "unconvertedCurrencies.",
  whatsDue:
    "Everything Due within N days (default 30), soonest first: Contracts' notice deadlines and end dates, " +
    "Warranties' end dates and, when those modules are enabled, Vehicles' rego, insurance and service " +
    "dates and Tenancies' lease ends, the same entries Needs attention lists as Due. Each entry has kind, " +
    "id, title, field, date, daysLeft, state and label; state is due-soon (inside its due-soon window) or " +
    "overdue (an Expired Contract, a passed Vehicle date). Dates not yet in their due-soon window, an " +
    "auto-renewing Contract's renewal date, Ended Contracts, Lapsed Warranties and Cancelled Contracts " +
    "are never Due, so they are not listed.",
} as const;
