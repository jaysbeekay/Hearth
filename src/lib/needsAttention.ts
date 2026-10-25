import type { Contract, Product, Vehicle } from "@/generated/prisma/client";
import { isDue, type DueContext, type DueEntry } from "@/lib/duePolicy";
import { contractDue, tenancyDue, vehicleDue, warrantyDue, type ContractDueRow } from "@/lib/dueRecords";
import { contractRules, listHref, productRules } from "@/lib/recordFilters";

export type AttentionKind = "contract" | "warranty" | "vehicle" | "property" | "system";

/**
 * #357 — "due" is anything with a date coming up or passed; "housekeeping"
 * is about the record itself (missing details, unconfirmed extraction,
 * reminder failures, setup gaps). See GLOSSARY.md.
 */
export type AttentionGroup = "due" | "housekeeping";

export interface AttentionAction {
  label: string;
  href: string;
}

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  group: AttentionGroup;
  title: string;
  subtitle?: string;
  /**
   * The Due entry behind the row, from the Due policy: every Due row has
   * one, as does a Housekeeping row about a date that needs replacing.
   * Absent for other Housekeeping rows.
   */
  entry?: DueEntry;
  href: string;
  /** Absent when there's nothing to do but know about it (an expiring warranty). */
  action?: AttentionAction;
  /** #357 — shown as a small badge, never as the row's main action. */
  noDocument?: boolean;
  /**
   * Whether this item can also be marked cancelled directly from the queue —
   * true only for overdue contracts. Kept as a flag rather than a bound
   * action here: this module stays data-only, and the rendering component
   * binds `setContractStatus` itself using `id`, the same server action the
   * contract detail page's own "Mark as cancelled" button uses.
   */
  canMarkCancelled?: boolean;
  /** Short status pill shown instead of/alongside the expiry badge — e.g. "Not configured", "Needs review", "Reminder failed" (#200/#201). */
  badge?: string;
}


// #384 — every Due row, and the Housekeeping rows for a date that has
// passed and needs a new one, come from the Due policy (ADR 0002): a row per
// Due entry, carrying the entry so its badge shows the policy's state and
// label. Ended Contracts and Lapsed Warranties have nothing to do, so they
// leave the queue.

type AttentionContract = Pick<Contract, "id" | "title" | "provider"> &
  ContractDueRow & { _count: { documents: number } };

export function buildContractAttentionItems(contracts: AttentionContract[], ctx: DueContext): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const contract of contracts) {
    for (const entry of contractDue(contract, ctx)) {
      if (entry.state === "needs-new-end-date") {
        // An auto-renewing Contract past its end date carried on into its
        // next Term: tidying, not a deadline.
        const href = `/contracts/${contract.id}/edit`;
        items.push({
          id: `new-end-date-${contract.id}`,
          kind: "contract",
          group: "housekeeping",
          title: contract.title,
          subtitle: "Renewed automatically, so its end date has passed.",
          entry,
        href: `/contracts/${contract.id}`,
          action: { label: "Set the new end date", href },
        });
        continue;
      }
      if (!isDue(entry)) continue;
      items.push({
        id: contract.id,
        kind: "contract",
        group: "due",
        title: contract.title,
        subtitle: contract.provider,
        entry,
        href: `/contracts/${contract.id}`,
        // The detail page's expiry banner is where renewing or cancelling
        // actually happens; the edit form isn't a renewal (#353). A
        // fixed-term Contract is meant to end, so there's nothing to renew:
        // like an expiring Warranty, its row is to know about.
        action:
          contract.renewalType === "FIXED_TERM"
            ? undefined
            : { label: "Renew or cancel", href: `/contracts/${contract.id}` },
        noDocument: contract._count.documents === 0,
        canMarkCancelled: entry.state === "overdue",
      });
    }
  }
  return items;
}

type AttentionProduct = Pick<Product, "id" | "description" | "manufacturer" | "warrantyEndDate" | "reminderDaysBefore"> & {
  _count: { documents: number };
};

export function buildWarrantyAttentionItems(products: AttentionProduct[], ctx: DueContext): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const product of products) {
    // Only a Warranty ending soon is Due; a Lapsed one leaves the queue.
    const entry = warrantyDue(product, ctx).find(isDue);
    if (!entry) continue;
    // A warranty running out is something to know, not something to do,
    // so the row has no action button (#357).
    items.push({
      id: product.id,
      kind: "warranty",
      group: "due",
      title: product.description,
      subtitle: product.manufacturer ?? undefined,
      entry,
      href: `/products/${product.id}`,
      noDocument: product._count.documents === 0,
    });
  }
  return items;
}

const VEHICLE_ACTIONS = new Map<string, string>([
  ["regoExpiry", "Renew registration"],
  ["insuranceExpiry", "Renew insurance"],
  ["nextServiceDue", "Book service"],
]);

type AttentionVehicle = Pick<Vehicle, "id" | "label" | "regoExpiry" | "insuranceExpiry" | "nextServiceDue" | "reminderDaysBefore">;

/** One row per Due entry: a Vehicle's rego, insurance and service are separate dates, each with its own state. */
export function buildVehicleAttentionItems(vehicles: AttentionVehicle[], ctx: DueContext): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const vehicle of vehicles) {
    for (const entry of vehicleDue(vehicle, ctx)) {
      if (!isDue(entry)) continue;
      items.push({
        id: `${vehicle.id}-${entry.field}`,
        kind: "vehicle",
        group: "due",
        title: vehicle.label,
        entry,
        href: `/vehicles/${vehicle.id}`,
        action: { label: VEHICLE_ACTIONS.get(entry.field) ?? "Update", href: `/vehicles/${vehicle.id}/edit` },
      });
    }
  }
  return items;
}

export interface AttentionTenancy {
  propertyId: string;
  propertyLabel: string;
  agreementId: string;
  tenantName: string | null;
  leaseEnd: Date | null;
}

/**
 * A Tenancy's lease end is Due before it passes; once passed, the Tenancy
 * needs its new lease end, which is Housekeeping.
 */
export function buildTenancyAttentionItems(tenancies: AttentionTenancy[], ctx: DueContext): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const tenancy of tenancies) {
    const editHref = `/home/${tenancy.propertyId}/rental/agreements/${tenancy.agreementId}/edit`;
    const href = `/home/${tenancy.propertyId}/rental`;
    for (const entry of tenancyDue(tenancy, ctx)) {
      if (entry.state === "needs-new-end-date") {
        items.push({
          id: `lease-ended-${tenancy.agreementId}`,
          kind: "property",
          group: "housekeeping",
          title: tenancy.propertyLabel,
          subtitle: tenancy.tenantName ?? undefined,
          entry,
          href,
          action: { label: "Set the new lease end", href: editHref },
        });
      } else if (isDue(entry)) {
        items.push({
          id: `lease-${tenancy.agreementId}`,
          kind: "property",
          group: "due",
          title: tenancy.propertyLabel,
          subtitle: tenancy.tenantName ?? undefined,
          entry,
          href,
          action: { label: "Update tenancy", href: editHref },
        });
      }
    }
  }
  return items;
}

export function buildReminderNudgeItem(): AttentionItem {
  return {
    id: "system-reminders",
    kind: "system",
    group: "housekeeping",
    title: "Reminders aren't configured",
    subtitle: "Hearth can email or push a reminder before things come due.",
    href: "/settings/app",
    action: { label: "Configure reminders", href: "/settings/app" },
    badge: "Not configured",
  };
}

// #200: contracts/products where a document scan populated critical fields
// and the user saved without confirming them — pinned like the reminder
// nudge (no Due entry) since "needs review" isn't a decaying, date-driven gap.
export function buildExtractionReviewItems(
  contracts: Contract[],
  products: Product[],
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const contract of contracts) {
    if (!contractRules.review.matches(contract)) continue;
    items.push({
      id: `review-contract-${contract.id}`,
      kind: "contract",
      group: "housekeeping",
      title: contract.title,
      subtitle: "Some auto-filled details haven't been confirmed yet.",
      href: `/contracts/${contract.id}`,
      action: { label: "Confirm details", href: `/contracts/${contract.id}` },
      badge: "Needs review",
    });
  }
  for (const product of products) {
    if (!productRules.review.matches(product)) continue;
    items.push({
      id: `review-product-${product.id}`,
      kind: "warranty",
      group: "housekeeping",
      title: product.description,
      subtitle: "Some auto-filled details haven't been confirmed yet.",
      href: `/products/${product.id}`,
      action: { label: "Confirm details", href: `/products/${product.id}` },
      badge: "Needs review",
    });
  }
  return items;
}

export interface FailedReminderLog {
  ownerType: "CONTRACT" | "PRODUCT" | "VEHICLE";
  ownerId: string;
  error: string | null;
}

// #201: a FAILED NotificationLog row is the current state for that
// threshold and date — recordNotificationOutcome upserts the same row to
// SENT the moment a retry succeeds. Callers pass only rows for a record's
// current Reminder entries (currentFailedLogs, #387), since rows for an
// earlier date are history. One row per owner (not per failed channel/threshold) —
// a household doesn't need the same broken delivery reported repeatedly.
export function buildReminderFailureItems(
  failedLogs: FailedReminderLog[],
  contracts: Contract[],
  products: Product[],
  vehicles: Vehicle[],
): AttentionItem[] {
  const contractMap = new Map(contracts.map((c) => [c.id, c]));
  const productMap = new Map(products.map((p) => [p.id, p]));
  const vehicleMap = new Map(vehicles.map((v) => [v.id, v]));
  const seenOwners = new Set<string>();
  const items: AttentionItem[] = [];

  for (const log of failedLogs) {
    const ownerKey = `${log.ownerType}:${log.ownerId}`;
    if (seenOwners.has(ownerKey)) continue;
    seenOwners.add(ownerKey);

    const suffix = log.error ? `: ${log.error}` : "";
    if (log.ownerType === "CONTRACT") {
      const contract = contractMap.get(log.ownerId);
      if (!contract) continue;
      items.push({
        id: `failed-contract-${contract.id}`,
        kind: "contract",
        group: "housekeeping",
        title: contract.title,
        subtitle: `Reminder delivery failed${suffix}`,
        href: `/contracts/${contract.id}`,
        action: { label: "View", href: `/contracts/${contract.id}` },
        badge: "Reminder failed",
      });
    } else if (log.ownerType === "PRODUCT") {
      const product = productMap.get(log.ownerId);
      if (!product) continue;
      items.push({
        id: `failed-product-${product.id}`,
        kind: "warranty",
        group: "housekeeping",
        title: product.description,
        subtitle: `Reminder delivery failed${suffix}`,
        href: `/products/${product.id}`,
        action: { label: "View", href: `/products/${product.id}` },
        badge: "Reminder failed",
      });
    } else {
      const vehicle = vehicleMap.get(log.ownerId);
      if (!vehicle) continue;
      items.push({
        id: `failed-vehicle-${vehicle.id}`,
        kind: "vehicle",
        group: "housekeeping",
        title: vehicle.label,
        subtitle: `Reminder delivery failed${suffix}`,
        href: `/vehicles/${vehicle.id}`,
        action: { label: "View", href: `/vehicles/${vehicle.id}` },
        badge: "Reminder failed",
      });
    }
  }
  return items;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

// #356/#357 — the Inbox count and the "missing info" counts used to be
// dashboard stat cards; they're housekeeping, so they live in the queue and
// only appear when there's something to tidy.
export function buildInboxItem(inboxCount: number): AttentionItem[] {
  if (inboxCount === 0) return [];
  return [
    {
      id: "inbox",
      kind: "system",
      group: "housekeeping",
      title: `${plural(inboxCount, "document", "documents")} waiting in your Inbox`,
      href: "/documents/inbox",
      action: { label: "Review", href: "/documents/inbox" },
    },
  ];
}

// #395 — one row per record type, counted with the rules in
// src/lib/recordFilters.ts and linking to the list filtered by the same rule.
// A Contract's cost with no billing frequency (#303) is one of its key
// details rather than a row of its own.
export function buildMissingDetailsItems(counts: {
  contracts: number;
  warranties: number;
  vehicles?: number;
}): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (counts.contracts > 0) {
    const href = listHref("/contracts", { missingDetails: true });
    items.push({
      id: "missing-details-contracts",
      kind: "contract",
      group: "housekeeping",
      title: `${plural(counts.contracts, "contract is", "contracts are")} missing key details`,
      subtitle: "No end date, or a cost with no billing frequency.",
      href,
      action: { label: "Fill in", href },
    });
  }
  if (counts.warranties > 0) {
    const href = listHref("/products", { missingDetails: true });
    items.push({
      id: "missing-details-warranties",
      kind: "warranty",
      group: "housekeeping",
      title: `${plural(counts.warranties, "warranty is", "warranties are")} missing key details`,
      subtitle: "No end date, or no serial number or barcode.",
      href,
      action: { label: "Fill in", href },
    });
  }
  if (counts.vehicles && counts.vehicles > 0) {
    const href = listHref("/vehicles", { missingDetails: true });
    items.push({
      id: "missing-details-vehicles",
      kind: "vehicle",
      group: "housekeeping",
      title: `${plural(counts.vehicles, "vehicle is", "vehicles are")} missing key details`,
      subtitle: "No VIN or plate.",
      href,
      action: { label: "Fill in", href },
    });
  }
  return items;
}

/**
 * #357 — splits the queue so the soonest real deadline is always the first
 * Due row: overdue first (most overdue on top), then soonest upcoming.
 * Housekeeping keeps the order it was built in.
 */
export function groupAttentionItems(items: AttentionItem[]): {
  due: AttentionItem[];
  housekeeping: AttentionItem[];
} {
  const due = items
    .filter((item) => item.group === "due")
    .sort((a, b) => (a.entry?.daysLeft ?? 0) - (b.entry?.daysLeft ?? 0));
  const housekeeping = items.filter((item) => item.group === "housekeeping");
  return { due, housekeeping };
}
