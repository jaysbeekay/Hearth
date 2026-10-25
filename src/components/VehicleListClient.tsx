"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { linkButtonClass, toolbarButtonClass, exportMenuItemClass } from "@/lib/buttonStyles";
import { Plus, ChevronDown } from "lucide-react";
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

type VehicleWithCount = VehicleModel & { _count: { items: number } };

interface Props {
  vehicles: VehicleWithCount[];
  filters: ListFilters;
  /** #395 — household-wide, from the server; never recounted here. */
  counts: ListFilterCounts;
  /** #384 — the household's today and default thresholds, for each card's Due pills. */
  due: DueContext;
  dateFormat?: string;
  canWrite?: boolean;
}

export function VehicleListClient({ vehicles, filters, counts, due, dateFormat, canWrite = true }: Props) {
  const online = useOnlineStatus();
  const router = useRouter();
  const { pendingOps, refresh: refreshPending } = usePendingCreates("vehicle");

  const filtered = hasListFilters(filters);

  useEffect(() => {
    cachePageData("vehicles:list", vehicles).catch(() => {});
  }, [vehicles]);

  useEffect(() => {
    const onSyncComplete = () => router.refresh();
    window.addEventListener("offline-sync-complete", onSyncComplete);
    return () => window.removeEventListener("offline-sync-complete", onSyncComplete);
  }, [router]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{MODULE_REGISTRY.VEHICLES.label}</h1>
        <div className="flex items-center gap-2">
          <details className="relative">
            <summary className={toolbarButtonClass}>
              Export <ChevronDown size={14} />
            </summary>
            <div className="absolute right-0 z-10 mt-1 w-28 overflow-hidden rounded-lg border border-border bg-surface shadow-md">
              <a href="/api/export/vehicles?format=csv" download className={exportMenuItemClass}>CSV</a>
              <a href="/api/export/vehicles?format=pdf" download className={exportMenuItemClass}>PDF</a>
            </div>
          </details>
          {canWrite && (
            <Link
              href="/vehicles/new"
              aria-disabled={!online}
              tabIndex={!online ? -1 : undefined}
              className={linkButtonClass("primary", { online })}
            >
              <Plus size={16} />
              Add vehicle
            </Link>
          )}
        </div>
      </div>

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
          <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted">
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
    </div>
  );
}
