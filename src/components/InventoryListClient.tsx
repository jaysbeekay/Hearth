"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ListPageHeader } from "@/components/ListPageHeader";
import { InventoryCard } from "@/components/InventoryCard";
import { PendingRecordCard } from "@/components/PendingRecordCard";
import type { InventoryItemModel } from "@/generated/prisma/models";
import { cachePageData } from "@/lib/offlineCache";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { usePendingCreates } from "@/lib/usePendingCreates";
import { MODULE_REGISTRY } from "@/lib/modules/registry";

type InventoryItemWithCount = InventoryItemModel & { _count: { documents: number } };

interface Props {
  items: InventoryItemWithCount[];
  dateFormat?: string;
  region?: string;
  canWrite?: boolean;
}

export function InventoryListClient({ items, dateFormat, region, canWrite = true }: Props) {
  const online = useOnlineStatus();
  const router = useRouter();
  const { pendingOps, refresh: refreshPending } = usePendingCreates("inventoryItem");

  useEffect(() => {
    cachePageData("inventory:list", items).catch(() => {});
  }, [items]);

  useEffect(() => {
    const onSyncComplete = () => router.refresh();
    window.addEventListener("offline-sync-complete", onSyncComplete);
    return () => window.removeEventListener("offline-sync-complete", onSyncComplete);
  }, [router]);

  return (
    <div className="space-y-6">
      <ListPageHeader
        title={MODULE_REGISTRY.INVENTORY.label}
        action={canWrite ? { href: "/inventory/new", label: "Add item", online } : undefined}
      />

      {pendingOps.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {pendingOps.map((op) => (
            <PendingRecordCard
              key={op.id}
              op={op}
              title={op.formValues?.label || "Untitled item"}
              subtitle={op.formValues?.brand}
              editHref={`/inventory/new?pendingOpId=${op.id}`}
              onDeleted={refreshPending}
            />
          ))}
        </div>
      )}

      {items.length === 0 ? (
        pendingOps.length === 0 && (
          <p className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted">
            No items yet. Add your first inventory item to start cataloguing your household.
          </p>
        )
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <InventoryCard key={item.id} item={item} dateFormat={dateFormat} region={region} />
          ))}
        </div>
      )}
    </div>
  );
}
