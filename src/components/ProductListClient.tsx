"use client";

import { useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { ListPageHeader } from "@/components/ListPageHeader";
import { useRouter } from "next/navigation";
import { Plus, X, Upload } from "lucide-react";
import { ProductCard } from "@/components/ProductCard";
import { InventoryCard } from "@/components/InventoryCard";
import { PendingRecordCard } from "@/components/PendingRecordCard";
import { ListFilterSheet } from "@/components/ListFilterSheet";
import { ListFilterChips, ListFilterHiddenInputs } from "@/components/ListFilterChips";
import type { InventoryItemModel, ProductModel } from "@/generated/prisma/models";
import {
  hasListFilters,
  isChipActive,
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
import { buttonClass, chipClass, emptyStateClass, inputClass } from "@/lib/ui";
import { PageShell } from "@/components/ui/PageShell";
import { cn } from "@/lib/utils";

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
  const activeFilters = CHIPS.filter(({ chip }) => isChipActive(filters, chip)).length;
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

  // #406 — a list with nothing in it yet shows one sentence and one button:
  // no Export, search or filter chips until there is something to act on.
  const nothingYet = !filtered && products.length === 0 && pendingOps.length === 0;

  return (
    <PageShell width="list">
      <ListPageHeader
        title="Warranties"
        exportPath={nothingYet ? undefined : "/api/export/products"}
        action={canWrite ? { href: "/products/new", label: "Add warranty", online } : undefined}
      />

      {!nothingYet && (
        <div className="flex flex-col gap-3">
          {/* #365 — no Filter button: the search submits as you type (or on
              Enter). Below md the chips move into the Filters sheet. */}
          <div className="flex gap-2 md:gap-3">
            <form ref={formRef} className="flex min-w-0 flex-1" method="GET">
              <ListFilterHiddenInputs filters={filters} />
              <input
                type="search"
                name="q"
                defaultValue={q}
                aria-label="Search warranties"
                placeholder="Search by description, brand, model, vendor, serial number, or barcode…"
                onChange={() => {
                  clearTimeout(searchTimeout.current);
                  searchTimeout.current = setTimeout(() => formRef.current?.requestSubmit(), 400);
                }}
                className={cn(inputClass, "min-w-0 flex-1")}
              />
            </form>
            <ListFilterSheet active={activeFilters}>
              <ListFilterChips filters={filters} chips={CHIPS} counts={counts} onToggle={toggleFilter} />
            </ListFilterSheet>
          </div>
          <ListFilterChips
            filters={filters}
            chips={CHIPS}
            counts={counts}
            onToggle={toggleFilter}
            className="hidden md:flex"
          />
        </div>
      )}

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
              className={chipClass(true)}
            >
              &quot;{q}&quot; <X size={16} />
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
          <div className={emptyStateClass("flex flex-col items-center gap-3")}>
            <p className="text-sm text-muted">
              {filtered
                ? "No warranties match your search or filters."
                : "No warranties yet. Add one manually, or upload an invoice and we'll fill in the details."}
            </p>
            {!filtered && canWrite && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Link href="/products/new" className={buttonClass("primary")}>
                  <Plus size={16} />
                  Add warranty
                </Link>
                <Link href="/import" className={buttonClass("secondary")}>
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
              <h2 className="text-base font-medium">Inventory items</h2>
              <p className="text-sm text-muted">Household purchases and valuables catalogued separately from warranties.</p>
            </div>
            {canWrite && (
              <Link
                href="/inventory/new"
                aria-disabled={!online}
                tabIndex={!online ? -1 : undefined}
                className={`${buttonClass("secondary", { online })} shrink-0 whitespace-nowrap`}
              >
                <Plus size={16} />
                Add item
              </Link>
            )}
          </div>
          {inventoryItems.length === 0 ? (
            <p className={emptyStateClass()}>
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
    </PageShell>
  );
}
