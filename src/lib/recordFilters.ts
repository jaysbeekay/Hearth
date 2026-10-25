// #395 — the one home for list filter rules and their URL vocabulary.
//
// Each rule is defined once per record type and gives both a Prisma `where`
// (for lists, Search and counts) and an in-memory `matches` (for pages that
// already hold the rows, such as the dashboard). The two must select the
// same records; tests/unit/record-filters.test.ts checks that against a real
// database. Lists, Search, the dashboard and Needs attention import their
// rules from here instead of writing their own `where` clauses.
//
// Rules here: Missing key details, Needs review, no Document, Important.
// Due / expiring are not defined here: they belong to the Due policy (ADR
// 0002, #383/#384). This module only owns the `?due=` URL parameter, so the
// policy can be swapped in behind it without the URL changing.
//
// No runtime imports, only types, so client components can use the URL
// helpers too.
import type { Prisma } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// URL vocabulary
// ---------------------------------------------------------------------------

/**
 * `?due=` values. `soon` and `overdue` are Due states (GLOSSARY.md). `lapsed`
 * is not: a Lapsed Warranty is never Due, but the Warranties list still
 * offers it as a filter, so it has its own word rather than borrowing
 * `overdue` (#384).
 */
export type DueFilter = "soon" | "overdue" | "lapsed";

/** The list filters a URL can carry. Absent means "not filtered by this". */
export interface ListFilters {
  /** `?due=soon` / `?due=overdue` / `?due=lapsed` */
  due?: DueFilter;
  /** `?missing=details` */
  missingDetails?: boolean;
  /** `?review=1` */
  review?: boolean;
  /** `?noDocument=1` */
  noDocument?: boolean;
  /** `?important=1` */
  important?: boolean;
}

export type ToggleableFilter = "dueSoon" | "overdue" | "lapsed" | "missingDetails" | "review" | "noDocument" | "important";

/** Query parameter names owned by this module. Pages keep their own (q, category, status…). */
export const LIST_FILTER_PARAMS = ["due", "missing", "review", "noDocument", "important"] as const;

/** Parameters from before #395, still accepted so bookmarks and old links keep working. */
export const LEGACY_LIST_PARAMS = ["expiring", "expired", "missingInfo", "needsReview", "missingDocument"] as const;

type SearchParamsLike = URLSearchParams | Record<string, string | string[] | undefined>;

function read(params: SearchParamsLike, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function entries(params: SearchParamsLike): [string, string][] {
  if (params instanceof URLSearchParams) return [...params.entries()];
  const out: [string, string][] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    for (const v of Array.isArray(value) ? value : [value]) out.push([key, v]);
  }
  return out;
}

export function parseListFilters(params: SearchParamsLike): ListFilters {
  const filters: ListFilters = {};
  const due = read(params, "due");
  if (due === "soon" || due === "overdue" || due === "lapsed") filters.due = due;
  if (read(params, "missing") === "details") filters.missingDetails = true;
  if (read(params, "review") === "1") filters.review = true;
  if (read(params, "noDocument") === "1") filters.noDocument = true;
  if (read(params, "important") === "1") filters.important = true;
  return filters;
}

export function hasListFilters(filters: ListFilters): boolean {
  return Boolean(filters.due || filters.missingDetails || filters.review || filters.noDocument || filters.important);
}

/** Writes the filters onto `params` in their canonical form, replacing any already there. */
export function writeListFilters(params: URLSearchParams, filters: ListFilters): URLSearchParams {
  for (const key of LIST_FILTER_PARAMS) params.delete(key);
  if (filters.due) params.set("due", filters.due);
  if (filters.missingDetails) params.set("missing", "details");
  if (filters.review) params.set("review", "1");
  if (filters.noDocument) params.set("noDocument", "1");
  if (filters.important) params.set("important", "1");
  return params;
}

/**
 * A list URL: `path` plus any page-specific params (search text, category…)
 * and the filters. Empty values are dropped.
 */
export function listHref(path: string, filters: ListFilters, extra: Record<string, string | undefined> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(extra)) if (value) params.set(key, value);
  writeListFilters(params, filters);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/** Flips one chip. Due soon, overdue and lapsed share `?due=`, so turning one on turns the others off. */
export function toggleListFilter(filters: ListFilters, chip: ToggleableFilter): ListFilters {
  const next = { ...filters };
  switch (chip) {
    case "dueSoon":
      next.due = filters.due === "soon" ? undefined : "soon";
      break;
    case "overdue":
      next.due = filters.due === "overdue" ? undefined : "overdue";
      break;
    case "lapsed":
      next.due = filters.due === "lapsed" ? undefined : "lapsed";
      break;
    default:
      next[chip] = !filters[chip] || undefined;
  }
  return next;
}

export function isChipActive(filters: ListFilters, chip: ToggleableFilter): boolean {
  if (chip === "dueSoon") return filters.due === "soon";
  if (chip === "overdue") return filters.due === "overdue";
  if (chip === "lapsed") return filters.due === "lapsed";
  return Boolean(filters[chip]);
}

/**
 * Maps a pre-#395 list URL onto the current vocabulary. Returns the URL to
 * redirect to, or null when `params` has no old-style parameter. Other
 * parameters (q, category, status…) are kept.
 *
 * - `expiring=<days>` → `due=soon`
 * - `expired=true` → `due=overdue` (`due=lapsed` on the Warranties list)
 * - `missingInfo=true` → `missing=details`
 * - `needsReview=true` → `review=1`
 * - `missingDocument=true` → `noDocument=1`
 */
export function legacyListRedirect(path: string, params: SearchParamsLike): string | null {
  const all = entries(params);
  if (!all.some(([key]) => (LEGACY_LIST_PARAMS as readonly string[]).includes(key))) return null;

  const next = new URLSearchParams();
  for (const [key, value] of all) {
    if (!(LEGACY_LIST_PARAMS as readonly string[]).includes(key)) next.append(key, value);
  }
  const filters = parseListFilters(next);
  const expiringDays = Number(read(params, "expiring"));
  if (read(params, "expired") === "true") filters.due ??= path === "/products" ? "lapsed" : "overdue";
  else if (Number.isFinite(expiringDays) && expiringDays > 0) filters.due ??= "soon";
  if (read(params, "missingInfo") === "true") filters.missingDetails = true;
  if (read(params, "needsReview") === "true") filters.review = true;
  if (read(params, "missingDocument") === "true") filters.noDocument = true;
  writeListFilters(next, filters);
  const query = next.toString();
  return query ? `${path}?${query}` : path;
}

/**
 * #384 — the Warranties list's Lapsed filter used to be `?due=overdue`, but a
 * Lapsed Warranty is never Due, so it's `?due=lapsed` now. Returns the
 * `/products` URL to redirect an old link to, or null. Other parameters are
 * kept.
 */
export function warrantyLapsedRedirect(params: SearchParamsLike): string | null {
  if (read(params, "due") !== "overdue") return null;
  const next = new URLSearchParams(entries(params));
  next.set("due", "lapsed");
  return `/products?${next.toString()}`;
}

/**
 * Search (`/api/search`) takes the same parameters as the lists. Before
 * #395 it took a single `filter=` value; those still work. "Missing
 * reminder" and "Missing link" were never real gaps (a blank threshold means
 * the household default; linking is optional), so they map to nothing.
 */
export function parseSearchFilters(params: SearchParamsLike): ListFilters {
  const filters = parseListFilters(params);
  switch (read(params, "filter")) {
    case "expiring":
      filters.due ??= "soon";
      break;
    case "needsReview":
      filters.review = true;
      break;
    case "noDocument":
      filters.noDocument = true;
      break;
    case "important":
      filters.important = true;
      break;
    case "missingDate":
    case "missingIdentifier":
      filters.missingDetails = true;
      break;
  }
  return filters;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export interface RecordRule<Where, Row> {
  /** Complete `where`: includes the liveness conditions, so it can be used on its own or inside `AND`. */
  where: Where;
  matches(row: Row): boolean;
}

/** Live (not soft-deleted) Documents of a record, as loaded with `documents: { where: { deletedAt: null }, select: { isImportant: true } }`. */
export interface LiveDocumentsRow {
  documents: { isImportant: boolean }[];
}

// --- Contracts --------------------------------------------------------------

export type ContractRuleRow = {
  deletedAt: Date | null;
  status: string;
  endDate: Date | null;
  renewalType: string;
  cost: number | null;
  billingFrequency: string | null;
  extractionPending: boolean;
};

export type ContractMissingPart = "No end date" | "No billing frequency";

/**
 * Which parts of Missing key details a Contract lacks (GLOSSARY.md). Empty
 * when nothing is missing, and always empty for a Cancelled or deleted
 * Contract. Contract number is not a key detail.
 */
export function contractMissingParts(row: Omit<ContractRuleRow, "extractionPending">): ContractMissingPart[] {
  if (row.deletedAt != null || row.status === "CANCELLED") return [];
  const parts: ContractMissingPart[] = [];
  if (row.endDate == null && row.renewalType !== "AUTO_RENEW") parts.push("No end date");
  if (row.cost != null && row.billingFrequency == null) parts.push("No billing frequency");
  return parts;
}

/** The fields `contractMissingParts` needs, for a Prisma `select`. */
export const CONTRACT_MISSING_SELECT = {
  deletedAt: true,
  status: true,
  endDate: true,
  renewalType: true,
  cost: true,
  billingFrequency: true,
} as const satisfies Prisma.ContractSelect;

const LIVE_CONTRACT = { deletedAt: null } as const satisfies Prisma.ContractWhereInput;

export const contractRules = {
  missingDetails: {
    where: {
      deletedAt: null,
      status: { not: "CANCELLED" },
      OR: [
        { endDate: null, renewalType: { not: "AUTO_RENEW" } },
        { cost: { not: null }, billingFrequency: null },
      ],
    },
    matches: (row) => contractMissingParts(row).length > 0,
  } satisfies RecordRule<Prisma.ContractWhereInput, Omit<ContractRuleRow, "extractionPending">>,

  review: {
    where: { ...LIVE_CONTRACT, extractionPending: true },
    matches: (row) => row.deletedAt == null && row.extractionPending,
  } satisfies RecordRule<Prisma.ContractWhereInput, Pick<ContractRuleRow, "deletedAt" | "extractionPending">>,

  noDocument: {
    where: { ...LIVE_CONTRACT, documents: { none: { deletedAt: null } } },
    matches: (row) => row.deletedAt == null && row.documents.length === 0,
  } satisfies RecordRule<Prisma.ContractWhereInput, Pick<ContractRuleRow, "deletedAt"> & LiveDocumentsRow>,

  important: {
    where: { ...LIVE_CONTRACT, documents: { some: { deletedAt: null, isImportant: true } } },
    matches: (row) => row.deletedAt == null && row.documents.some((d) => d.isImportant),
  } satisfies RecordRule<Prisma.ContractWhereInput, Pick<ContractRuleRow, "deletedAt"> & LiveDocumentsRow>,
};

/** The `where` conditions for the non-Due filters in `filters`, to AND into a Contract query. */
export function contractFilterWheres(filters: ListFilters): Prisma.ContractWhereInput[] {
  const wheres: Prisma.ContractWhereInput[] = [];
  if (filters.missingDetails) wheres.push(contractRules.missingDetails.where);
  if (filters.review) wheres.push(contractRules.review.where);
  if (filters.noDocument) wheres.push(contractRules.noDocument.where);
  if (filters.important) wheres.push(contractRules.important.where);
  return wheres;
}

// --- Vehicles ---------------------------------------------------------------

export type VehicleRuleRow = { deletedAt: Date | null; vin: string | null; licensePlate: string | null };

export type VehicleMissingPart = "No VIN or plate";

export function vehicleMissingParts(row: VehicleRuleRow): VehicleMissingPart[] {
  if (row.deletedAt != null) return [];
  return row.vin == null && row.licensePlate == null ? ["No VIN or plate"] : [];
}

export const VEHICLE_MISSING_SELECT = { deletedAt: true, vin: true, licensePlate: true } as const satisfies Prisma.VehicleSelect;

export const vehicleRules = {
  missingDetails: {
    where: { deletedAt: null, vin: null, licensePlate: null },
    matches: (row) => vehicleMissingParts(row).length > 0,
  } satisfies RecordRule<Prisma.VehicleWhereInput, VehicleRuleRow>,
};

export function vehicleFilterWheres(filters: ListFilters): Prisma.VehicleWhereInput[] {
  return filters.missingDetails ? [vehicleRules.missingDetails.where] : [];
}

// --- Warranties (Products) and Inventory items ----------------------------
//
// Item rules arrive with #380. Until then these keep the behaviour the
// Warranties list and dashboard already had, now shared with Search.

export type ProductRuleRow = {
  deletedAt: Date | null;
  warrantyEndDate: Date | null;
  serialNumber: string | null;
  barcode: string | null;
  extractionPending: boolean;
};

export type ProductMissingPart = "No warranty end date" | "No serial number or barcode";

export function productMissingParts(row: Omit<ProductRuleRow, "extractionPending">): ProductMissingPart[] {
  if (row.deletedAt != null) return [];
  const parts: ProductMissingPart[] = [];
  if (row.warrantyEndDate == null) parts.push("No warranty end date");
  if (row.serialNumber == null && row.barcode == null) parts.push("No serial number or barcode");
  return parts;
}

export const PRODUCT_MISSING_SELECT = {
  deletedAt: true,
  warrantyEndDate: true,
  serialNumber: true,
  barcode: true,
} as const satisfies Prisma.ProductSelect;

const LIVE_PRODUCT = { deletedAt: null } as const satisfies Prisma.ProductWhereInput;

export const productRules = {
  missingDetails: {
    where: {
      deletedAt: null,
      OR: [{ warrantyEndDate: null }, { serialNumber: null, barcode: null }],
    },
    matches: (row) => productMissingParts(row).length > 0,
  } satisfies RecordRule<Prisma.ProductWhereInput, Omit<ProductRuleRow, "extractionPending">>,

  review: {
    where: { ...LIVE_PRODUCT, extractionPending: true },
    matches: (row) => row.deletedAt == null && row.extractionPending,
  } satisfies RecordRule<Prisma.ProductWhereInput, Pick<ProductRuleRow, "deletedAt" | "extractionPending">>,

  noDocument: {
    where: { ...LIVE_PRODUCT, documents: { none: { deletedAt: null } } },
    matches: (row) => row.deletedAt == null && row.documents.length === 0,
  } satisfies RecordRule<Prisma.ProductWhereInput, Pick<ProductRuleRow, "deletedAt"> & LiveDocumentsRow>,

  important: {
    where: { ...LIVE_PRODUCT, documents: { some: { deletedAt: null, isImportant: true } } },
    matches: (row) => row.deletedAt == null && row.documents.some((d) => d.isImportant),
  } satisfies RecordRule<Prisma.ProductWhereInput, Pick<ProductRuleRow, "deletedAt"> & LiveDocumentsRow>,
};

export function productFilterWheres(filters: ListFilters): Prisma.ProductWhereInput[] {
  const wheres: Prisma.ProductWhereInput[] = [];
  if (filters.missingDetails) wheres.push(productRules.missingDetails.where);
  if (filters.review) wheres.push(productRules.review.where);
  if (filters.noDocument) wheres.push(productRules.noDocument.where);
  if (filters.important) wheres.push(productRules.important.where);
  return wheres;
}

export type InventoryRuleRow = { deletedAt: Date | null; serialNumber: string | null };

export function inventoryMissingParts(row: InventoryRuleRow): "No serial number"[] {
  return row.deletedAt == null && row.serialNumber == null ? ["No serial number"] : [];
}

export const inventoryRules = {
  missingDetails: {
    where: { deletedAt: null, serialNumber: null },
    matches: (row) => inventoryMissingParts(row).length > 0,
  } satisfies RecordRule<Prisma.InventoryItemWhereInput, InventoryRuleRow>,
};

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

/**
 * Household-wide count per chip, worked out on the server from the same
 * rules the list uses, so a chip's count is the length of the list it opens.
 * List clients only display these.
 */
export type ListFilterCounts = Partial<Record<ToggleableFilter, number>> & { recentlyAdded?: number };
