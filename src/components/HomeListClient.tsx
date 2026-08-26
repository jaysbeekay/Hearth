"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { linkButtonClass, toolbarButtonClass, exportMenuItemClass } from "@/lib/buttonStyles";
import { Plus, ChevronDown } from "lucide-react";
import { PropertyCard } from "@/components/PropertyCard";
import { PendingRecordCard } from "@/components/PendingRecordCard";
import type { PropertyModel } from "@/generated/prisma/models";
import { formatCurrency } from "@/lib/utils";
import { cachePageData } from "@/lib/offlineCache";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { usePendingCreates } from "@/lib/usePendingCreates";

type PropertyWithCount = PropertyModel & { _count: { items: number } };

interface TaxSummaryEntry {
  label: string;
  amount: number;
  currency: string;
}

interface Props {
  properties: PropertyWithCount[];
  taxDeductibleSummary: TaxSummaryEntry[];
  region?: string;
}

export function HomeListClient({ properties, taxDeductibleSummary, region }: Props) {
  const online = useOnlineStatus();
  const router = useRouter();
  const { pendingOps, refresh: refreshPending } = usePendingCreates("property");

  useEffect(() => {
    cachePageData("properties:list", properties).catch(() => {});
  }, [properties]);

  useEffect(() => {
    const onSyncComplete = () => router.refresh();
    window.addEventListener("offline-sync-complete", onSyncComplete);
    return () => window.removeEventListener("offline-sync-complete", onSyncComplete);
  }, [router]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Properties</h1>
        <div className="flex items-center gap-2">
          <details className="relative">
            <summary className={toolbarButtonClass}>
              Export <ChevronDown size={14} />
            </summary>
            <div className="absolute right-0 z-10 mt-1 w-28 overflow-hidden rounded-lg border border-border bg-surface shadow-md">
              <a href="/api/export/home?format=csv" download className={exportMenuItemClass}>CSV</a>
              <a href="/api/export/home?format=pdf" download className={exportMenuItemClass}>PDF</a>
            </div>
          </details>
          <Link
            href="/home/new"
            aria-disabled={!online}
            tabIndex={!online ? -1 : undefined}
            className={linkButtonClass("primary", { online })}
          >
            <Plus size={16} />
            Add property
          </Link>
        </div>
      </div>

      {taxDeductibleSummary.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
          <h2 className="mb-3 font-medium">Tax deductible spend by financial year</h2>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {taxDeductibleSummary.map(({ label, amount, currency }) => (
              <div key={`${label}|${currency}`}>
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="text-sm font-medium">{formatCurrency(amount, currency, undefined, region)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {pendingOps.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {pendingOps.map((op) => (
            <PendingRecordCard
              key={op.id}
              op={op}
              title={op.formValues?.label || "Untitled property"}
              subtitle={op.formValues?.street || op.formValues?.suburb}
              editHref={`/home/new?pendingOpId=${op.id}`}
              onDeleted={refreshPending}
            />
          ))}
        </div>
      )}

      {properties.length === 0 ? (
        pendingOps.length === 0 && (
          <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted">
            No properties yet. Add your first property to start tracking maintenance and improvements.
          </p>
        )
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {properties.map((property) => (
            <PropertyCard key={property.id} property={property} />
          ))}
        </div>
      )}
    </div>
  );
}
