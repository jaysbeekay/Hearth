"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { linkButtonClass, toolbarButtonClass, exportMenuItemClass } from "@/lib/buttonStyles";
import { useRouter } from "next/navigation";
import { Plus, ChevronDown, X, Upload } from "lucide-react";
import { ProductCard } from "@/components/ProductCard";
import { PendingRecordCard } from "@/components/PendingRecordCard";
import { ListSummaryStrip } from "@/components/ListSummaryStrip";
import type { ProductModel } from "@/generated/prisma/models";
import { daysUntil } from "@/lib/utils";
import { cachePageData } from "@/lib/offlineCache";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { usePendingCreates } from "@/lib/usePendingCreates";

interface Props {
  products: ProductModel[];
  q?: string;
  expiring?: string;
  expired?: string;
  needsReview?: string;
  missingDocument?: string;
  dateFormat?: string;
  region?: string;
  canWrite?: boolean;
}

export function ProductListClient({
  products,
  q,
  expiring,
  expired,
  needsReview,
  missingDocument,
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

  const filtered = Boolean(q || expiring || expired || needsReview || missingDocument);

  // #207 — completeness filter chips, same toggle pattern as ContractListClient.
  function toggleCompletenessFilter(key: "expiring" | "expired" | "needsReview" | "missingDocument", value: string) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (expiring) params.set("expiring", expiring);
    if (expired) params.set("expired", expired);
    if (needsReview) params.set("needsReview", needsReview);
    if (missingDocument) params.set("missingDocument", missingDocument);

    const isActive = params.get(key) === value;
    if (key === "expiring" || key === "expired") {
      params.delete("expiring");
      params.delete("expired");
    }
    if (!isActive) params.set(key, value);
    else params.delete(key);
    router.push(`/products${params.toString() ? `?${params.toString()}` : ""}`);
  }

  const summary = useMemo(() => {
    let expiringSoon = 0;
    let expired = 0;
    let recentlyAdded = 0;
    let needsReview = 0;
    const weekAgo = new Date().getTime() - 7 * 86_400_000;
    for (const product of products) {
      const days = daysUntil(product.warrantyEndDate);
      if (days != null && days < 0) expired++;
      else if (days != null && days <= 30) expiringSoon++;
      if (new Date(product.createdAt).getTime() >= weekAgo) recentlyAdded++;
      if (product.extractionPending) needsReview++;
    }
    return [
      { label: "expiring within 30 days", value: expiringSoon, tone: "warning" as const },
      { label: "expired", value: expired, tone: "danger" as const },
      { label: "needs review", value: needsReview, tone: "warning" as const },
      { label: "added this week", value: recentlyAdded },
    ];
  }, [products]);

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

      <div className="flex flex-wrap gap-2 text-sm">
        {[
          { key: "expiring" as const, value: "30", label: "Expiring soon", active: expiring === "30" },
          { key: "expired" as const, value: "true", label: "Expired", active: expired === "true" },
          { key: "needsReview" as const, value: "true", label: "Needs review", active: needsReview === "true" },
          {
            key: "missingDocument" as const,
            value: "true",
            label: "Missing document",
            active: missingDocument === "true",
          },
        ].map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => toggleCompletenessFilter(chip.key, chip.value)}
            aria-pressed={chip.active}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              chip.active
                ? "border-accent bg-accent/10 text-accent"
                : "border-border bg-surface text-muted hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {filtered && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">
            {products.length} {products.length === 1 ? "product" : "products"}
          </span>
          {q && (
            <button
              type="button"
              onClick={() => router.push("/products")}
              className="flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-xs hover:bg-black/5 dark:hover:bg-white/5"
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
              title={op.formValues?.description || "Untitled product"}
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
            <p className="text-sm text-foreground/60">
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
            <ProductCard key={product.id} product={product} dateFormat={dateFormat} region={region} />
          ))}
        </div>
      )}
    </div>
  );
}
