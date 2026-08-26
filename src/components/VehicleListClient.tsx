"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { linkButtonClass, toolbarButtonClass, exportMenuItemClass } from "@/lib/buttonStyles";
import { Plus, ChevronDown } from "lucide-react";
import { VehicleCard } from "@/components/VehicleCard";
import { PendingRecordCard } from "@/components/PendingRecordCard";
import type { VehicleModel } from "@/generated/prisma/models";
import { cachePageData } from "@/lib/offlineCache";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { usePendingCreates } from "@/lib/usePendingCreates";

type VehicleWithCount = VehicleModel & { _count: { items: number } };

interface Props {
  vehicles: VehicleWithCount[];
  dateFormat?: string;
  canWrite?: boolean;
}

export function VehicleListClient({ vehicles, dateFormat, canWrite = true }: Props) {
  const online = useOnlineStatus();
  const router = useRouter();
  const { pendingOps, refresh: refreshPending } = usePendingCreates("vehicle");

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
        <h1 className="text-2xl font-semibold">Vehicles</h1>
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
            No vehicles yet. Add your first vehicle to start tracking registration, insurance, and service history.
          </p>
        )
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {vehicles.map((vehicle) => (
            <VehicleCard key={vehicle.id} vehicle={vehicle} dateFormat={dateFormat} />
          ))}
        </div>
      )}
    </div>
  );
}
