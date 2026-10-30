import type { Metadata } from "next";
import {
  FileText,
  Package,
  Car,
  Home,
  Plane,
  Box,
  Trash2,
  Wrench,
  Receipt,
  KeyRound,
  TrendingUp,
  ArrowLeftRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { auth } from "@/lib/auth";
import { getTrashEntries, purgeExpiredTrash, TRASH_RETENTION_DAYS, type TrashEntry } from "@/lib/trash";
import { getUserPreferences } from "@/lib/userPreferences";
import { formatTimestamp } from "@/lib/utils";
import { TrashRestoreButton } from "@/components/TrashRestoreButton";
import { ConfirmForm } from "@/components/ConfirmForm";
import { restoreContract, permanentlyDeleteContract } from "@/lib/actions/contracts";
import { restoreProduct, permanentlyDeleteProduct } from "@/lib/actions/products";
import {
  restoreVehicle,
  permanentlyDeleteVehicle,
  restoreVehicleItem,
  permanentlyDeleteVehicleItem,
} from "@/lib/actions/vehicles";
import {
  restoreProperty,
  permanentlyDeleteProperty,
  restoreHomeItem,
  permanentlyDeleteHomeItem,
  restoreRentalAgreement,
  permanentlyDeleteRentalAgreement,
  restoreRentalStatement,
  permanentlyDeleteRentalStatement,
} from "@/lib/actions/home";
import {
  restoreTrip,
  permanentlyDeleteTrip,
  restoreTripSegment,
  permanentlyDeleteTripSegment,
} from "@/lib/actions/trips";
import {
  restoreTrade,
  permanentlyDeleteTrade,
  restorePropertyValuation,
  permanentlyDeletePropertyValuation,
} from "@/lib/actions/wealth";
import { restoreInventoryItem, permanentlyDeleteInventoryItem } from "@/lib/actions/inventory";
import { restoreDocumentAction, permanentlyDeleteDocumentAction } from "@/lib/actions/documents";
import { DOCUMENT_KIND_LABEL, type OwnedDocumentKind } from "@/lib/documents/kinds";
import { canWrite as sessionCanWrite } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";
import { SETTINGS_ROUTES, settingsBackLink } from "@/lib/routeLabels";

export const metadata: Metadata = { title: SETTINGS_ROUTES.trash.label };

type RecordDomain = Exclude<TrashEntry["domain"], "document">;

const DOMAIN_META: Record<
  RecordDomain,
  { label: string; icon: LucideIcon; restore: (id: string) => Promise<unknown>; permanentlyDelete: (id: string) => Promise<unknown> }
> = {
  contract: { label: "Contract", icon: FileText, restore: restoreContract, permanentlyDelete: permanentlyDeleteContract },
  product: { label: "Warranty", icon: Package, restore: restoreProduct, permanentlyDelete: permanentlyDeleteProduct },
  vehicle: { label: "Vehicle", icon: Car, restore: restoreVehicle, permanentlyDelete: permanentlyDeleteVehicle },
  property: { label: "Property", icon: Home, restore: restoreProperty, permanentlyDelete: permanentlyDeleteProperty },
  trip: { label: "Trip", icon: Plane, restore: restoreTrip, permanentlyDelete: permanentlyDeleteTrip },
  inventoryItem: { label: "Inventory item", icon: Box, restore: restoreInventoryItem, permanentlyDelete: permanentlyDeleteInventoryItem },
  homeItem: { label: "Maintenance record", icon: Wrench, restore: restoreHomeItem, permanentlyDelete: permanentlyDeleteHomeItem },
  vehicleItem: { label: "Service record", icon: Wrench, restore: restoreVehicleItem, permanentlyDelete: permanentlyDeleteVehicleItem },
  tripSegment: { label: "Trip segment", icon: Plane, restore: restoreTripSegment, permanentlyDelete: permanentlyDeleteTripSegment },
  rentalStatement: {
    label: "Rental statement",
    icon: Receipt,
    restore: restoreRentalStatement,
    permanentlyDelete: permanentlyDeleteRentalStatement,
  },
  tenancy: { label: "Tenancy", icon: KeyRound, restore: restoreRentalAgreement, permanentlyDelete: permanentlyDeleteRentalAgreement },
  propertyValuation: {
    label: "Property valuation",
    icon: TrendingUp,
    restore: restorePropertyValuation,
    permanentlyDelete: permanentlyDeletePropertyValuation,
  },
  trade: { label: "Trade", icon: ArrowLeftRight, restore: restoreTrade, permanentlyDelete: permanentlyDeleteTrade },
};

// Looks a domain up without indexing by a caller-supplied key: restoreAction
// is a server action, so its bound `domain` argument arrives from the browser.
function recordDomainMeta(domain: string) {
  return Object.entries(DOMAIN_META).find(([key]) => key === domain)?.[1];
}

// One restore entry point for every row, returning the domain action's
// ActionState so TrashRestoreButton can show an error.
async function restoreAction(
  domain: TrashEntry["domain"],
  id: string,
  documentKind?: OwnedDocumentKind,
): Promise<unknown> {
  "use server";
  if (domain === "document") {
    if (!documentKind) return { error: "Document not found." };
    return restoreDocumentAction(documentKind, id);
  }
  const meta = recordDomainMeta(domain);
  if (!meta) return { error: "Record not found." };
  return meta.restore(id);
}

// A Document of any kind is one domain; its kind picks the label and the
// arguments for the Document actions (#396).
function metaFor(entry: TrashEntry) {
  if (entry.domain === "document" && entry.documentKind) {
    const kind = entry.documentKind;
    return {
      label: Object.entries(DOCUMENT_KIND_LABEL).find(([key]) => key === kind)?.[1] ?? "Document",
      icon: FileText,
      permanentlyDelete: permanentlyDeleteDocumentAction.bind(null, kind, entry.id),
    };
  }
  const meta = recordDomainMeta(entry.domain);
  if (!meta) throw new Error(`Unknown Trash domain: ${entry.domain}`);
  return { ...meta, permanentlyDelete: meta.permanentlyDelete.bind(null, entry.id) };
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

  const [session, { dateFormat, displayTimeZone }] = await Promise.all([auth(), getUserPreferences()]);
  const entries = await getTrashEntries(dateFormat);
  const canWrite = sessionCanWrite(session);

  return (
    <div className="max-w-2xl space-y-6">
      <BackLink {...settingsBackLink(SETTINGS_ROUTES.trash)} />
      <div>
        <h1 className="text-2xl font-semibold">{SETTINGS_ROUTES.trash.label}</h1>
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
            const meta = metaFor(entry);
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
                      {formatTimestamp(entry.deletedAt, dateFormat, displayTimeZone)} ·{" "}
                      {remaining === 0 ? "Expires today" : `${remaining} day${remaining === 1 ? "" : "s"} left`}
                    </p>
                  </div>
                </div>
                {canWrite && (
                  <div className="flex shrink-0 items-center gap-2">
                    <TrashRestoreButton action={restoreAction.bind(null, entry.domain, entry.id, entry.documentKind)} />
                    <ConfirmForm
                      action={meta.permanentlyDelete}
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
