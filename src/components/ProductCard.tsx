import Link from "next/link";
import type { ProductModel } from "@/generated/prisma/models";
import { ExpiryBadge } from "@/components/ExpiryBadge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { headlineEntry, warrantyDue, type DueContext } from "@/lib/dueRecords";

export function ProductCard({
  product,
  due,
  dateFormat,
  region,
  missing,
}: {
  product: ProductModel & { _count?: { documents: number } };
  /** #384 — the household's today and default thresholds, for the Due policy. */
  due: DueContext;
  dateFormat?: string;
  region?: string;
  /** #395 — which key details are missing, shown when the list is filtered to them. */
  missing?: string[];
}) {
  const entry = headlineEntry(warrantyDue(product, due));

  return (
    <Link
      href={`/products/${product.id}`}
      className="block min-w-0 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-accent/50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-muted">
            {product.manufacturer ?? product.vendor ?? "Warranty"}
          </p>
          <p className="truncate font-medium">{product.description}</p>
          {product.serialNumber && (
            <p className="truncate text-sm text-muted">S/N: {product.serialNumber}</p>
          )}
        </div>
        <ExpiryBadge entry={entry} empty="No warranty end date" />
      </div>

      <div className="mt-3 flex items-center justify-between text-sm text-muted">
        <span>
          {product.warrantyEndDate
            ? `Warranty ends ${formatDate(product.warrantyEndDate, dateFormat)}`
            : "No warranty end date"}
        </span>
        {product.price != null && (
          <span>{formatCurrency(product.price, product.currency, undefined, region)}</span>
        )}
      </div>

      {missing && missing.length > 0 && (
        <p className="mt-1 text-xs font-medium text-muted">{missing.join(" · ")}</p>
      )}

      {product._count != null && product._count.documents > 0 && (
        <p className="mt-1 text-xs text-muted">
          {product._count.documents} {product._count.documents === 1 ? "doc" : "docs"}
        </p>
      )}
    </Link>
  );
}
