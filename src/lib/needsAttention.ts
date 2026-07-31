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
    const candidates = [
      rego != null && rego <= 30 ? { field: "rego" as const, days: rego } : null,
      insurance != null && insurance <= 30 ? { field: "insurance" as const, days: insurance } : null,
    ].filter((c): c is { field: "rego" | "insurance"; days: number } => c != null);
    if (candidates.length === 0) continue;

    // Whichever is more pressing (most overdue, or soonest) drives the label.
    const driving = candidates.reduce((a, b) => (a.days < b.days ? a : b));
    items.push({
      id: vehicle.id,
      kind: "vehicle",
      title: vehicle.label,
      subtitle: candidates.length > 1 ? "Rego and insurance both due soon" : undefined,
      days: driving.days,
      href: `/vehicles/${vehicle.id}`,
      action: {
        label: driving.field === "rego" ? "Renew registration" : "Renew insurance",
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
  };
}

export function sortAttentionItems(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => sortKey(a.days) - sortKey(b.days));
}
