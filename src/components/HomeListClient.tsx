"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PropertyCard } from "@/components/PropertyCard";
import type { PropertyModel } from "@/generated/prisma/models";
import { formatCurrency } from "@/lib/utils";
import { cachePageData } from "@/lib/offlineCache";

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
    cachePageData("properties:list", properties).catch(() => {});
  }, [properties]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Home</h1>
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
