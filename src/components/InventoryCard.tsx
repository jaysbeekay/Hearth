import Link from "next/link";
import type { InventoryItemModel } from "@/generated/prisma/models";
import { formatDate, formatCurrency } from "@/lib/utils";

const CATEGORY_LABELS: Record<string, string> = {
  APPLIANCE: "Appliance",
  ELECTRONICS: "Electronics",
  FURNITURE: "Furniture",
  TOOL: "Tool",
  CLOTHING: "Clothing",
  SPORTING: "Sporting",
  BOOK: "Book",
  MEDIA: "Media",
  OTHER: "Other",
};

export function InventoryCard({
  item,
}: {
  item: InventoryItemModel & { _count?: { documents: number } };
}) {
  const subtitle = [item.brand, item.model].filter(Boolean).join(" · ");

  return (
    <Link
      href={`/inventory/${item.id}`}
      className="block min-w-0 rounded-lg border border-border bg-surface p-4 shadow-stripe transition hover:border-accent/50"
    >
      <div className="min-w-0">
        {subtitle && <p className="truncate text-sm text-muted">{subtitle}</p>}
        <p className="truncate font-medium">{item.label}</p>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-muted/10 px-2 py-0.5 text-xs font-medium text-muted">
            {CATEGORY_LABELS[item.category] ?? item.category}
          </span>
          {item.location && (
            <span className="rounded-full bg-muted/10 px-2 py-0.5 text-xs text-muted">
              {item.location}
            </span>
          )}
        </div>

        {item._count != null && (
          <span className="text-sm text-muted tabular-nums">
            {item._count.documents} {item._count.documents === 1 ? "doc" : "docs"}
          </span>
        )}
      </div>

      {(item.purchaseDate || item.purchasePrice != null) && (
        <div className="mt-2 flex flex-wrap gap-4">
          {item.purchaseDate && (
            <p className="text-xs text-muted">Purchased: {formatDate(item.purchaseDate)}</p>
          )}
          {item.purchasePrice != null && (
            <p className="text-xs text-muted">{formatCurrency(item.purchasePrice, item.currency)}</p>
          )}
        </div>
      )}
    </Link>
  );
}
