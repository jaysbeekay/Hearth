import type { Metadata } from "next";
import { FileText, Package, Car, Home, Plane, Box, RotateCcw, Trash2, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { auth } from "@/lib/auth";
import { getTrashEntries, purgeExpiredTrash, TRASH_RETENTION_DAYS, type TrashEntry } from "@/lib/trash";
import { getUserPreferences } from "@/lib/userPreferences";
import { formatDate } from "@/lib/utils";
import { SubmitButton } from "@/components/SubmitButton";
import { ConfirmForm } from "@/components/ConfirmForm";
import {
  restoreContract,
  permanentlyDeleteContract,
  restoreDocument,
  permanentlyDeleteDocument,
} from "@/lib/actions/contracts";
import {
  restoreProduct,
  permanentlyDeleteProduct,
  restoreProductDocument,
  permanentlyDeleteProductDocument,
} from "@/lib/actions/products";
import {
  restoreVehicle,
  permanentlyDeleteVehicle,
  restoreVehicleItem,
  permanentlyDeleteVehicleItem,
  restoreVehicleItemDocument,
  permanentlyDeleteVehicleItemDocument,
} from "@/lib/actions/vehicles";
import {
  restoreProperty,
  permanentlyDeleteProperty,
  restoreHomeItem,
  permanentlyDeleteHomeItem,
  restoreHomeItemDocument,
  permanentlyDeleteHomeItemDocument,
} from "@/lib/actions/home";
import {
  restoreTrip,
  permanentlyDeleteTrip,
} from "@/lib/actions/trips";
import {
  restoreInventoryItem,
  permanentlyDeleteInventoryItem,
  restoreInventoryItemDocument,
  permanentlyDeleteInventoryItemDocument,
} from "@/lib/actions/inventory";

export const metadata: Metadata = { title: "Trash" };

const DOMAIN_META: Record<
  TrashEntry["domain"],
  { label: string; icon: LucideIcon; restore: (id: string) => Promise<unknown>; permanentlyDelete: (id: string) => Promise<unknown> }
> = {
  contract: { label: "Contract", icon: FileText, restore: restoreContract, permanentlyDelete: permanentlyDeleteContract },
  product: { label: "Warranty", icon: Package, restore: restoreProduct, permanentlyDelete: permanentlyDeleteProduct },
  vehicle: { label: "Vehicle", icon: Car, restore: restoreVehicle, permanentlyDelete: permanentlyDeleteVehicle },
  property: { label: "Property", icon: Home, restore: restoreProperty, permanentlyDelete: permanentlyDeleteProperty },
  trip: { label: "Trip", icon: Plane, restore: restoreTrip, permanentlyDelete: permanentlyDeleteTrip },
  inventoryItem: { label: "Inventory item", icon: Box, restore: restoreInventoryItem, permanentlyDelete: permanentlyDeleteInventoryItem },
  contractDocument: { label: "Policy document", icon: FileText, restore: restoreDocument, permanentlyDelete: permanentlyDeleteDocument },
  productDocument: { label: "Warranty document", icon: FileText, restore: restoreProductDocument, permanentlyDelete: permanentlyDeleteProductDocument },
  homeItem: { label: "Property item", icon: Wrench, restore: restoreHomeItem, permanentlyDelete: permanentlyDeleteHomeItem },
  homeItemDocument: { label: "Property item document", icon: FileText, restore: restoreHomeItemDocument, permanentlyDelete: permanentlyDeleteHomeItemDocument },
  vehicleItem: { label: "Vehicle item", icon: Wrench, restore: restoreVehicleItem, permanentlyDelete: permanentlyDeleteVehicleItem },
  vehicleItemDocument: { label: "Vehicle item document", icon: FileText, restore: restoreVehicleItemDocument, permanentlyDelete: permanentlyDeleteVehicleItemDocument },
  inventoryItemDocument: { label: "Inventory document", icon: FileText, restore: restoreInventoryItemDocument, permanentlyDelete: permanentlyDeleteInventoryItemDocument },
};

// A plain <form action> requires a void-returning action; the domain
// restore functions return ActionState (used elsewhere via useActionState),
// so this thin wrapper is the adapter between the two.
async function restoreAction(domain: TrashEntry["domain"], id: string): Promise<void> {
  "use server";
  await DOMAIN_META[domain].restore(id);
}

function daysLeft(deletedAt: Date): number {
  const elapsedDays = (Date.now() - deletedAt.getTime()) / (24 * 60 * 60 * 1000);
  return Math.max(0, Math.ceil(TRASH_RETENTION_DAYS - elapsedDays));
}

export default async function TrashPage() {
  // Best-effort immediate sweep so a member who deliberately checks Trash
  // never sees something that's actually already past its window — the
  // scheduler's daily tick (src/lib/notifications/scheduler.ts) is the
  // other, lower-latency-independent trigger for the same purge.
  await purgeExpiredTrash().catch(() => {});

  const [session, { dateFormat }, entries] = await Promise.all([
    auth(),
    getUserPreferences(),
    getTrashEntries(),
  ]);
  const canWrite = session?.user.role !== "READONLY";

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Trash</h1>
        <p className="text-sm text-muted">
          Deleted records stay here for {TRASH_RETENTION_DAYS} days — restore them, or delete
          permanently right away. Their documents are kept until then too.
        </p>
      </div>

      {entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted">
          Trash is empty.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {entries.map((entry) => {
            const meta = DOMAIN_META[entry.domain];
            const Icon = meta.icon;
            const remaining = daysLeft(entry.deletedAt);
            return (
              <li key={`${entry.domain}-${entry.id}`} className="flex items-center justify-between gap-3 p-4">
                <div className="flex min-w-0 items-start gap-3">
                  <Icon size={18} className="mt-0.5 shrink-0 text-muted" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{entry.label}</p>
                    <p className="truncate text-xs text-muted">
                      {meta.label}
                      {entry.subtitle ? ` · ${entry.subtitle}` : ""} · Deleted{" "}
                      {formatDate(entry.deletedAt, dateFormat)} ·{" "}
                      {remaining === 0 ? "Expires today" : `${remaining} day${remaining === 1 ? "" : "s"} left`}
                    </p>
                  </div>
                </div>
                {canWrite && (
                  <div className="flex shrink-0 items-center gap-2">
                    <form action={restoreAction.bind(null, entry.domain, entry.id)}>
                      <SubmitButton variant="secondary" pendingText="Restoring…">
                        <RotateCcw size={14} className="mr-1.5" />
                        Restore
                      </SubmitButton>
                    </form>
                    <ConfirmForm
                      action={meta.permanentlyDelete.bind(null, entry.id)}
                      confirmText={`Permanently delete "${entry.label}"? This removes it and its documents for everyone in the household — it can't be undone.`}
                      actionLabel="Delete permanently"
                      successMessage="Deleted permanently."
                      className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-3 py-2 text-sm font-medium text-danger hover:bg-danger/10"
                    >
                      <Trash2 size={14} className="mr-1.5" />
                      Delete permanently
                    </ConfirmForm>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
