"use client";

import { useEffect } from "react";
import { ListPageHeader } from "@/components/ListPageHeader";
import { useRouter } from "next/navigation";
import { PropertyCard } from "@/components/PropertyCard";
import { PendingRecordCard } from "@/components/PendingRecordCard";
import type { PropertyModel } from "@/generated/prisma/models";
import { formatCurrency } from "@/lib/utils";
import { cachePageData } from "@/lib/offlineCache";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { usePendingCreates } from "@/lib/usePendingCreates";
import { useCanWrite } from "@/components/CanWriteProvider";
import { MODULE_REGISTRY } from "@/lib/modules/registry";
import { Card } from "@/components/ui/Card";
import { emptyStateClass } from "@/lib/ui";
import { PageShell } from "@/components/ui/PageShell";

type PropertyWithCount = PropertyModel & { _count: { items: number } };

interface TaxSummaryEntry {
  label: string;
  amount: number;
  currency: string;
}

interface Props {
  properties: PropertyWithCount[];
  /** #355 — Properties the household no longer has, listed apart from the rest. */
  archivedProperties?: PropertyWithCount[];
  taxDeductibleSummary: TaxSummaryEntry[];
  region?: string;
}

export function HomeListClient({ properties, archivedProperties = [], taxDeductibleSummary, region }: Props) {
  const online = useOnlineStatus();
  const canWrite = useCanWrite();
  const router = useRouter();
  const { pendingOps, refresh: refreshPending } = usePendingCreates("property");

  useEffect(() => {
    cachePageData("properties:list", [...properties, ...archivedProperties]).catch(() => {});
  }, [properties, archivedProperties]);

  useEffect(() => {
    const onSyncComplete = () => router.refresh();
    window.addEventListener("offline-sync-complete", onSyncComplete);
    return () => window.removeEventListener("offline-sync-complete", onSyncComplete);
  }, [router]);

  return (
    <PageShell width="list">
      <ListPageHeader
        title={MODULE_REGISTRY.HOME.label}
        exportPath="/api/export/home"
        action={canWrite ? { href: "/home/new", label: "Add property", online } : undefined}
      />

      {taxDeductibleSummary.length > 0 && (
        <Card>
          <h2 className="mb-3 font-medium">Tax-deductible spending by financial year</h2>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {taxDeductibleSummary.map(({ label, amount, currency }) => (
              <div key={`${label}|${currency}`}>
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="text-sm font-medium">{formatCurrency(amount, currency, undefined, region)}</dd>
              </div>
            ))}
          </dl>
        </Card>
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
          <p className={emptyStateClass()}>
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

      {archivedProperties.length > 0 && (
        <details data-testid="archived-section">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-muted hover:text-foreground">
            Archived ({archivedProperties.length})
          </summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {archivedProperties.map((property) => (
              <PropertyCard key={property.id} property={property} />
            ))}
          </div>
        </details>
      )}
    </PageShell>
  );
}
