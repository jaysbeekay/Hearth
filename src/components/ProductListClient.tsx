"use client";

import { useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { linkButtonClass, toolbarButtonClass, exportMenuItemClass } from "@/lib/buttonStyles";
import { useRouter } from "next/navigation";
import { Plus, ChevronDown, X, Upload } from "lucide-react";
import { ProductCard } from "@/components/ProductCard";
import { InventoryCard } from "@/components/InventoryCard";
import { PendingRecordCard } from "@/components/PendingRecordCard";
import { ListSummaryStrip } from "@/components/ListSummaryStrip";
import { ListFilterChips, ListFilterHiddenInputs } from "@/components/ListFilterChips";
import type { InventoryItemModel, ProductModel } from "@/generated/prisma/models";
import {
  hasListFilters,
  listHref,
  productMissingParts,
  toggleListFilter,
  type ListFilterCounts,
  type ListFilters,
  type ToggleableFilter,
} from "@/lib/recordFilters";
import type { DueContext } from "@/lib/duePolicy";
import { cachePageData } from "@/lib/offlineCache";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { usePendingCreates } from "@/lib/usePendingCreates";

const CHIPS: { chip: ToggleableFilter; label: string; onlyWhenActive?: boolean }[] = [
  { chip: "dueSoon", label: "Due soon" },
  // A Warranty past its end date is Lapsed, not Expired (GLOSSARY.md).
  { chip: "lapsed", label: "Lapsed" },
  { chip: "review", label: "Needs review" },
  { chip: "noDocument", label: "No document" },
  { chip: "missingDetails", label: "Missing key details" },
  { chip: "important", label: "Important", onlyWhenActive: true },
];

interface Props {
  products: ProductModel[];
  inventoryItems?: (InventoryItemModel & { _count: { documents: number } })[];
  inventoryEnabled?: boolean;
  /** #395 — household-wide, from the server; never recounted here. */
  counts: ListFilterCounts;
  /** #384 — the household's today and default thresholds, for each card's Due badge. */
  due: DueContext;
  filters: ListFilters;
  q?: string;
  dateFormat?: string;
  region?: string;
  canWrite?: boolean;
}

export function ProductListClient({
  products,
  inventoryItems = [],
  inventoryEnabled = true,
  counts,
  due,
  filters,
  q,
  dateFormat,
  region,
  canWrite = true,
}: Props) {
  const online = useOnlineStatus();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { pendingOps, refresh: refreshPending } = usePendingCreates("product");

  useEffect(() => {
    cachePageData("products:list", products).catch(() => {});
  }, [products]);

  useEffect(() => {
    const onSyncComplete = () => router.refresh();
    window.addEventListener("offline-sync-complete", onSyncComplete);
    return () => window.removeEventListener("offline-sync-complete", onSyncComplete);
  }, [router]);

  const filtered = Boolean(q || hasListFilters(filters));
  // Inventory items don't take part in the list filters, so while one is on
  // the page shows only the Warranties its count describes (#395).
  const showInventorySection =
    inventoryEnabled && !hasListFilters(filters) && (inventoryItems.length > 0 || !filtered);

  const toggleFilter = useCallback(
    (chip: ToggleableFilter) => {
      router.push(listHref("/products", toggleListFilter(filters, chip), { q }));
    },
    [filters, q, router],
  );

  const summary = [
    {
      label: "due soon",
      value: counts.dueSoon ?? 0,
      tone: "warning" as const,
      onClick: () => {
        toggleFilter("dueSoon");
      },
    },
    {
      label: "lapsed",
      value: counts.lapsed ?? 0,
      onClick: () => {
        toggleFilter("lapsed");
      },
    },
    {
      label: "needs review",
      value: counts.review ?? 0,
      tone: "warning" as const,
      onClick: () => {
        toggleFilter("review");
      },
    },
    { label: "added this week", value: counts.recentlyAdded ?? 0 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Warranties</h1>
        <div className="flex items-center gap-2">
          <details className="relative">
            <summary className={toolbarButtonClass}>
              Export <ChevronDown size={14} />
            </summary>
            <div className="absolute right-0 z-10 mt-1 w-28 overflow-hidden rounded-lg border border-border bg-surface shadow-md">
              <a href="/api/export/products?format=csv" download className={exportMenuItemClass}>CSV</a>
              <a href="/api/export/products?format=pdf" download className={exportMenuItemClass}>PDF</a>
            </div>
          </details>
          {canWrite && (
            <Link
              href="/products/new"
              aria-disabled={!online}
              tabIndex={!online ? -1 : undefined}
              className={linkButtonClass("primary", { online })}
            >
              <Plus size={16} />
              Add warranty
            </Link>
          )}
        </div>
      </div>

      <form ref={formRef} className="flex flex-col gap-3 md:flex-row" method="GET">
        <ListFilterHiddenInputs filters={filters} />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by description, brand, model, vendor, serial number, or barcode…"
          onChange={() => {
            clearTimeout(searchTimeout.current);
            searchTimeout.current = setTimeout(() => formRef.current?.requestSubmit(), 400);
          }}
          className="flex-1 min-h-11 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          className={toolbarButtonClass}
        >
          Filter
        </button>
      </form>

      <ListFilterChips filters={filters} chips={CHIPS} onToggle={toggleFilter} />

      {filtered && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">
              {products.length} {products.length === 1 ? "warranty" : "warranties"}
          </span>
          {q && (
            <button
              type="button"
              onClick={() => {
                router.push(listHref("/products", filters));
              }}
              className="flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-xs hover:bg-hover"
            >
              &quot;{q}&quot; <X size={12} />
            </button>
          )}
          <button
            type="button"
            onClick={() => router.push("/products")}
            className="text-xs text-muted underline hover:text-foreground"
          >
            Clear all
          </button>
        </div>
      )}

      {!filtered && products.length > 0 && <ListSummaryStrip items={summary} />}

      {pendingOps.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {pendingOps.map((op) => (
            <PendingRecordCard
              key={op.id}
              op={op}
              title={op.formValues?.description || "Untitled warranty"}
              subtitle={op.formValues?.manufacturer}
              editHref={`/products/new?pendingOpId=${op.id}`}
              onDeleted={refreshPending}
            />
          ))}
        </div>
      )}

      {products.length === 0 ? (
        pendingOps.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-10 text-center">
            <p className="text-sm text-muted">
              {filtered
                ? "No warranties match your search or filters."
                : "No warranties yet. Add one manually, or upload an invoice and we'll fill in the details."}
            </p>
            {!filtered && canWrite && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Link href="/products/new" className={linkButtonClass("primary")}>
                  <Plus size={16} />
                  Add warranty
                </Link>
                <Link href="/import" className={linkButtonClass("secondary")}>
                  <Upload size={16} />
                  Upload a document
                </Link>
              </div>
            )}
          </div>
        )
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              due={due}
              dateFormat={dateFormat}
              region={region}
              missing={filters.missingDetails ? productMissingParts(product) : undefined}
            />
          ))}
        </div>
      )}

      {showInventorySection && (
        <section className="space-y-3 border-t border-border pt-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Inventory items</h2>
              <p className="text-sm text-muted">Household purchases and valuables catalogued separately from warranties.</p>
            </div>
            {canWrite && (
              <Link
                href="/inventory/new"
                aria-disabled={!online}
                tabIndex={!online ? -1 : undefined}
                className={linkButtonClass("secondary", { online })}
              >
                <Plus size={16} />
                Add item
              </Link>
            )}
          </div>
          {inventoryItems.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
              No inventory items yet.
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {inventoryItems.map((item) => (
                <InventoryCard key={item.id} item={item} dateFormat={dateFormat} region={region} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
