import Link from "next/link";
import type { InventoryItemModel } from "@/generated/prisma/models";
import { formatDate, formatCurrency } from "@/lib/utils";
import { Pill } from "@/components/ui/Pill";
import { cardClass } from "@/lib/ui";

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
  dateFormat,
  region,
}: {
  item: InventoryItemModel & { _count?: { documents: number } };
  dateFormat?: string;
  region?: string;
}) {
  const subtitle = [item.brand, item.model].filter(Boolean).join(" · ");

  return (
    <Link
      href={`/inventory/${item.id}`}
      className={cardClass({ interactive: true }, "block min-w-0")}
    >
      <div className="min-w-0">
        {subtitle && <p className="truncate text-sm text-muted">{subtitle}</p>}
        <p className="truncate font-medium">{item.label}</p>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Pill>
            {CATEGORY_LABELS[item.category] ?? item.category}
          </Pill>
          {item.location && (
            <Pill>
              {item.location}
            </Pill>
          )}
        </div>

        {item._count != null && (
          <span className="text-sm text-muted">
            {item._count.documents} {item._count.documents === 1 ? "doc" : "docs"}
          </span>
        )}
      </div>

      {(item.purchaseDate || item.purchasePrice != null) && (
        <div className="mt-2 flex flex-wrap gap-4">
          {item.purchaseDate && (
            <p className="text-xs text-muted">Purchased: {formatDate(item.purchaseDate, dateFormat)}</p>
          )}
          {item.purchasePrice != null && (
            <p className="text-xs text-muted">{formatCurrency(item.purchasePrice, item.currency, undefined, region)}</p>
          )}
        </div>
      )}
    </Link>
  );
}
