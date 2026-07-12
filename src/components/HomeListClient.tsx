"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Plus, ChevronDown } from "lucide-react";
import { PropertyCard } from "@/components/PropertyCard";
import type { PropertyModel } from "@/generated/prisma/models";
import { formatCurrency } from "@/lib/utils";
import { cachePageData } from "@/lib/offlineCache";
import { useOnlineStatus } from "@/lib/useOnlineStatus";

type PropertyWithCount = PropertyModel & { _count: { items: number } };

interface TaxSummaryEntry {
  label: string;
  amount: number;
  currency: string;
}

interface Props {
  properties: PropertyWithCount[];
  taxDeductibleSummary: TaxSummaryEntry[];
}

export function HomeListClient({ properties, taxDeductibleSummary }: Props) {
  const online = useOnlineStatus();

  useEffect(() => {
    cachePageData("properties:list", properties).catch(() => {});
  }, [properties]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Home</h1>
        <div className="flex items-center gap-2">
          <details className="relative">
            <summary className="flex cursor-pointer list-none items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5">
              Export <ChevronDown size={14} />
            </summary>
            <div className="absolute right-0 z-10 mt-1 w-28 overflow-hidden rounded-lg border border-border bg-surface shadow-md">
              <a href="/api/export/home?format=csv" download className="block px-4 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5">CSV</a>
              <a href="/api/export/home?format=pdf" download className="block px-4 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5">PDF</a>
            </div>
          </details>
          <Link
            href="/home/new"
            aria-disabled={!online}
            tabIndex={!online ? -1 : undefined}
            className={`flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90${!online ? " pointer-events-none opacity-40" : ""}`}
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
                <dt className="text-xs text-foreground/50">{label}</dt>
                <dd className="text-sm font-medium">{formatCurrency(amount, currency)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {properties.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-foreground/60">
          No properties yet. Add your first property to start tracking maintenance and improvements.
        </p>
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
