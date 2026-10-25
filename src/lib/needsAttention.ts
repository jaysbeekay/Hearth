import type { Contract, Product, Vehicle } from "@/generated/prisma/client";
import { daysUntil } from "@/lib/utils";
import { contractTiming } from "@/lib/contractTiming";
import { contractRules, listHref, productRules } from "@/lib/recordFilters";

export type AttentionKind = "contract" | "warranty" | "vehicle" | "system";

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
  /** Days until due; negative means overdue. Absent for system-level items. */
  days: number | null;
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
  /** #351 — `days` counts to a contract's last day to give notice, not its end date. */
  cancelBy?: boolean;
  /** Short status pill shown instead of/alongside the expiry badge — e.g. "Not configured", "Needs review", "Reminder failed" (#200/#201). */
  badge?: string;
}


export function buildContractAttentionItems(
  contracts: (Contract & { _count: { documents: number } })[],
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const contract of contracts) {
    const timing = contractTiming(contract);
    const days = timing.days;
    if (days == null || days > 30) continue;

    const overdue = days < 0;
    items.push({
      id: contract.id,
      kind: "contract",
      group: "due",
      title: contract.title,
      subtitle: contract.provider,
      days,
      href: `/contracts/${contract.id}`,
      // The detail page's expiry banner is where renewing or cancelling
      // actually happens; the edit form isn't a renewal (#353).
      action: { label: "Renew or cancel", href: `/contracts/${contract.id}` },
      noDocument: contract._count.documents === 0,
      canMarkCancelled: overdue,
      cancelBy: timing.beforeCancelBy,
    });
  }
  return items;
}

export function buildWarrantyAttentionItems(
  products: (Product & { _count: { documents: number } })[],
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const product of products) {
    const days = daysUntil(product.warrantyEndDate);
    if (days == null || days > 30) continue;

    // A warranty running out is something to know, not something to do,
    // so the row has no action button (#357).
    items.push({
      id: product.id,
      kind: "warranty",
      group: "due",
      title: product.description,
      subtitle: product.manufacturer ?? undefined,
      days,
      href: `/products/${product.id}`,
      noDocument: product._count.documents === 0,
    });
  }
  return items;
}

export function buildVehicleAttentionItems(vehicles: Vehicle[]): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const vehicle of vehicles) {
    const rego = daysUntil(vehicle.regoExpiry);
    const insurance = daysUntil(vehicle.insuranceExpiry);
    const service = daysUntil(vehicle.nextServiceDue);
    const candidates = [
      rego != null && rego <= 30 ? { field: "rego" as const, days: rego } : null,
      insurance != null && insurance <= 30 ? { field: "insurance" as const, days: insurance } : null,
      service != null && service <= 30 ? { field: "service" as const, days: service } : null,
    ].filter((c): c is { field: "rego" | "insurance" | "service"; days: number } => c != null);
    if (candidates.length === 0) continue;

    // Whichever is more pressing (most overdue, or soonest) drives the label.
    const driving = candidates.reduce((a, b) => (a.days < b.days ? a : b));
    items.push({
      id: vehicle.id,
      kind: "vehicle",
      group: "due",
      title: vehicle.label,
      subtitle: candidates.length > 1 ? `${candidates.length} things due soon` : undefined,
      days: driving.days,
      href: `/vehicles/${vehicle.id}`,
      action: {
        label:
          driving.field === "rego"
            ? "Renew registration"
            : driving.field === "insurance"
              ? "Renew insurance"
              : "Book service",
        href: `/vehicles/${vehicle.id}/edit`,
      },
    });
  }
  return items;
}

export function buildReminderNudgeItem(): AttentionItem {
  return {
    id: "system-reminders",
    kind: "system",
    group: "housekeeping",
    title: "Reminders aren't configured",
    subtitle: "Hearth can email or push a notification before things expire.",
    days: null,
    href: "/settings/app",
    action: { label: "Configure reminders", href: "/settings/app" },
    badge: "Not configured",
  };
}

// #200: contracts/products where a document scan populated critical fields
// and the user saved without confirming them — pinned like the reminder
// nudge (days: null) since "needs review" isn't a decaying, date-driven gap.
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
      days: null,
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
      days: null,
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
        days: null,
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
        days: null,
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
        days: null,
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
      days: null,
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
      days: null,
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
      days: null,
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
      days: null,
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
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0));
  const housekeeping = items.filter((item) => item.group === "housekeeping");
  return { due, housekeeping };
}
