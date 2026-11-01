"use client";

import { useEffect } from "react";
import { ListPageHeader } from "@/components/ListPageHeader";
import { useRouter } from "next/navigation";
import { ListFilterChips } from "@/components/ListFilterChips";
import { VehicleCard } from "@/components/VehicleCard";
import { PendingRecordCard } from "@/components/PendingRecordCard";
import type { VehicleModel } from "@/generated/prisma/models";
import type { DueContext } from "@/lib/duePolicy";
import { cachePageData } from "@/lib/offlineCache";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { usePendingCreates } from "@/lib/usePendingCreates";
import {
  hasListFilters,
  listHref,
  toggleListFilter,
  vehicleMissingParts,
  type ListFilterCounts,
  type ListFilters,
} from "@/lib/recordFilters";
import { MODULE_REGISTRY } from "@/lib/modules/registry";
import { emptyStateClass } from "@/lib/ui";
import { PageShell } from "@/components/ui/PageShell";

type VehicleWithCount = VehicleModel & { _count: { items: number } };

interface Props {
  vehicles: VehicleWithCount[];
  /** #355 — Vehicles the household no longer has, listed apart from the rest. */
  archivedVehicles?: VehicleWithCount[];
  filters: ListFilters;
  /** #395 — household-wide, from the server; never recounted here. */
  counts: ListFilterCounts;
  /** #384 — the household's today and default thresholds, for each card's Due pills. */
  due: DueContext;
  dateFormat?: string;
  canWrite?: boolean;
}

export function VehicleListClient({ vehicles, archivedVehicles = [], filters, counts, due, dateFormat, canWrite = true }: Props) {
  const online = useOnlineStatus();
  const router = useRouter();
  const { pendingOps, refresh: refreshPending } = usePendingCreates("vehicle");

  const filtered = hasListFilters(filters);

  useEffect(() => {
    cachePageData("vehicles:list", [...vehicles, ...archivedVehicles]).catch(() => {});
  }, [vehicles, archivedVehicles]);

  useEffect(() => {
    const onSyncComplete = () => router.refresh();
    window.addEventListener("offline-sync-complete", onSyncComplete);
    return () => window.removeEventListener("offline-sync-complete", onSyncComplete);
  }, [router]);

  return (
    <PageShell width="list">
      <ListPageHeader
        title={MODULE_REGISTRY.VEHICLES.label}
        exportPath="/api/export/vehicles"
        action={canWrite ? { href: "/vehicles/new", label: "Add vehicle", online } : undefined}
      />

      {((counts.missingDetails ?? 0) > 0 || filtered) && (
        <ListFilterChips
          filters={filters}
          chips={[{ chip: "missingDetails", label: "Missing key details" }]}
          onToggle={(chip) => {
            router.push(listHref("/vehicles", toggleListFilter(filters, chip)));
          }}
        />
      )}

      {filtered && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">
            {vehicles.length} {vehicles.length === 1 ? "vehicle" : "vehicles"}
          </span>
          <button
            type="button"
            onClick={() => {
              router.push("/vehicles");
            }}
            className="text-xs text-muted underline hover:text-foreground"
          >
            Clear all
          </button>
        </div>
      )}

      {pendingOps.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {pendingOps.map((op) => (
            <PendingRecordCard
              key={op.id}
              op={op}
              title={op.formValues?.label || "Untitled vehicle"}
              subtitle={[op.formValues?.make, op.formValues?.model].filter(Boolean).join(" ")}
              editHref={`/vehicles/new?pendingOpId=${op.id}`}
              onDeleted={refreshPending}
            />
          ))}
        </div>
      )}

      {vehicles.length === 0 ? (
        pendingOps.length === 0 && (
          <p className={emptyStateClass()}>
            {filtered
              ? "No vehicles match these filters."
              : "No vehicles yet. Add your first vehicle to start tracking registration, insurance, and service history."}
          </p>
        )
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {vehicles.map((vehicle) => (
            <VehicleCard
              key={vehicle.id}
              vehicle={vehicle}
              due={due}
              dateFormat={dateFormat}
              missing={filters.missingDetails ? vehicleMissingParts(vehicle) : undefined}
            />
          ))}
        </div>
      )}

      {/* #355 — hidden while a filter is on, since the filters are about
          what the household still has. */}
      {!filtered && archivedVehicles.length > 0 && (
        <details data-testid="archived-section">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-muted hover:text-foreground">
            Archived ({archivedVehicles.length})
          </summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {archivedVehicles.map((vehicle) => (
              <VehicleCard key={vehicle.id} vehicle={vehicle} due={due} dateFormat={dateFormat} />
            ))}
          </div>
        </details>
      )}
    </PageShell>
  );
}
