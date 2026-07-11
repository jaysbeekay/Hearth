"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, ChevronDown } from "lucide-react";
import { ProductCard } from "@/components/ProductCard";
import type { ProductModel } from "@/generated/prisma/models";
import { cachePageData } from "@/lib/offlineCache";

interface Props {
  products: ProductModel[];
  q?: string;
  dateFormat?: string;
}

export function ProductListClient({ products, q, dateFormat }: Props) {
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
    cachePageData("products:list", products).catch(() => {});
  }, [products]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Products</h1>
        <div className="flex items-center gap-2">
          <details className="relative">
            <summary className="flex cursor-pointer list-none items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5">
              Export <ChevronDown size={14} />
            </summary>
            <div className="absolute right-0 z-10 mt-1 w-28 overflow-hidden rounded-lg border border-border bg-surface shadow-md">
              <a href="/api/export/products?format=csv" download className="block px-4 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5">CSV</a>
              <a href="/api/export/products?format=pdf" download className="block px-4 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5">PDF</a>
            </div>
          </details>
          <Link
            href="/products/new"
            aria-disabled={!online}
            tabIndex={!online ? -1 : undefined}
            className={`flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90${!online ? " pointer-events-none opacity-40" : ""}`}
          >
            <Plus size={16} />
            Add product
          </Link>
        </div>
      </div>

      <form className="flex flex-col gap-3 md:flex-row" method="GET">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by name, manufacturer, vendor, serial number, or barcode…"
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
        >
          Filter
        </button>
      </form>

      {products.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-foreground/60">
          {q
            ? "No products match your search."
            : "No products yet. Add your first product to get started."}
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} dateFormat={dateFormat} />
          ))}
        </div>
      )}
    </div>
  );
}
