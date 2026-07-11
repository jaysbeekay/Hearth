"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { InventoryCard } from "@/components/InventoryCard";
import type { InventoryItemModel } from "@/generated/prisma/models";
import { cachePageData } from "@/lib/offlineCache";

type InventoryItemWithCount = InventoryItemModel & { _count: { documents: number } };

interface Props {
  items: InventoryItemWithCount[];
  dateFormat?: string;
  canWrite?: boolean;
}

export function InventoryListClient({ items, dateFormat, canWrite = true }: Props) {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    cachePageData("inventory:list", items).catch(() => {});
  }, [items]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Inventory</h1>
        {canWrite && (
          <Link
            href="/inventory/new"
            aria-disabled={!online}
            tabIndex={!online ? -1 : undefined}
            className={`flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90${!online ? " pointer-events-none opacity-40" : ""}`}
          >
            <Plus size={16} />
            Add item
          </Link>
        )}
      </div>

      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-foreground/60">
          No items yet. Add your first inventory item to start cataloguing your household.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <InventoryCard key={item.id} item={item} dateFormat={dateFormat} />
          ))}
        </div>
      )}
    </div>
  );
}
