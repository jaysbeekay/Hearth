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
import { EmptyState, PageShell } from "@/components/ui";

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
    <PageShell width="list">
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
          <EmptyState as="p">
            No items yet. Add your first inventory item to start cataloguing your household.
          </EmptyState>
        )
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <InventoryCard key={item.id} item={item} dateFormat={dateFormat} region={region} />
          ))}
        </div>
      )}
    </PageShell>
  );
}
