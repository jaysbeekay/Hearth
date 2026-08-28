import type { Contract, Product, Vehicle } from "@/generated/prisma/client";
import { daysUntil } from "@/lib/utils";

export type AttentionKind = "contract" | "warranty" | "vehicle" | "system";

export interface AttentionAction {
  label: string;
  href: string;
}

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  title: string;
  subtitle?: string;
  /** Days until due; negative means overdue. Absent for system-level items. */
  days: number | null;
  href: string;
  action: AttentionAction;
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

// Sort key: overdue items first (more negative = more overdue), then soonest
// upcoming, with items lacking a natural due date (the reminders nudge)
// pinned ahead of everything else — it's a standing gap, not a decaying one.
function sortKey(days: number | null): number {
  return days ?? Number.NEGATIVE_INFINITY;
}

export function buildContractAttentionItems(
  contracts: (Contract & { _count: { documents: number } })[],
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const contract of contracts) {
    const days = daysUntil(contract.endDate);
    if (days == null || days > 30) continue;

    const hasDocument = contract._count.documents > 0;
    const overdue = days < 0;
    items.push({
      id: contract.id,
      kind: "contract",
      title: contract.title,
      subtitle: contract.provider,
      days,
      href: `/contracts/${contract.id}`,
      action: !hasDocument
        ? { label: "Upload document", href: `/contracts/${contract.id}#documents` }
        : { label: "Renew policy", href: `/contracts/${contract.id}/edit` },
      canMarkCancelled: overdue,
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

    const hasDocument = product._count.documents > 0;
    items.push({
      id: product.id,
      kind: "warranty",
      title: product.description,
      subtitle: product.manufacturer ?? undefined,
      days,
      href: `/products/${product.id}`,
      action: !hasDocument
        ? { label: "Upload document", href: `/products/${product.id}#documents` }
        : { label: "Review warranty", href: `/products/${product.id}` },
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
    if (!contract.extractionPending) continue;
    items.push({
      id: `review-contract-${contract.id}`,
      kind: "contract",
      title: contract.title,
      subtitle: "Some auto-filled details haven't been confirmed yet.",
      days: null,
      href: `/contracts/${contract.id}`,
      action: { label: "Confirm details", href: `/contracts/${contract.id}` },
      badge: "Needs review",
    });
  }
  for (const product of products) {
    if (!product.extractionPending) continue;
    items.push({
      id: `review-product-${product.id}`,
      kind: "warranty",
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

// #201: a FAILED NotificationLog row is always the *current* state for that
// threshold — recordNotificationOutcome upserts the same row to SENT the
// moment a retry succeeds, so anything still FAILED here is a live problem,
// not stale history. One row per owner (not per failed channel/threshold) —
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

export function sortAttentionItems(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => sortKey(a.days) - sortKey(b.days));
}
