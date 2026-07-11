import Link from "next/link";
import type { ProductModel } from "@/generated/prisma/models";
import { ExpiryBadge } from "@/components/ExpiryBadge";
import { daysUntil, formatCurrency, formatDate } from "@/lib/utils";

export function ProductCard({
  product,
  dateFormat,
}: {
  product: ProductModel & { _count?: { documents: number } };
  dateFormat?: string;
}) {
  const days = daysUntil(product.warrantyEndDate);

  return (
    <Link
      href={`/products/${product.id}`}
      className="block min-w-0 rounded-lg border border-border bg-surface p-4 shadow-stripe transition hover:border-accent/50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-muted">
            {product.manufacturer ?? product.vendor ?? "Product"}
          </p>
          <p className="truncate font-medium">{product.name}</p>
          {product.serialNumber && (
            <p className="truncate text-sm text-muted">S/N: {product.serialNumber}</p>
          )}
        </div>
        <ExpiryBadge days={days} />
      </div>

      <div className="mt-3 flex items-center justify-between text-sm text-muted">
        <span>
          {product.warrantyEndDate
            ? `Warranty ends ${formatDate(product.warrantyEndDate, dateFormat)}`
            : "No warranty end date"}
        </span>
        {product.price != null && (
          <span className="tabular-nums">{formatCurrency(product.price, product.currency)}</span>
        )}
      </div>

      {product._count != null && product._count.documents > 0 && (
        <p className="mt-1 text-xs text-muted tabular-nums">
          {product._count.documents} {product._count.documents === 1 ? "doc" : "docs"}
        </p>
      )}
    </Link>
  );
}
