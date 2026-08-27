import Link from "next/link";
import type { PropertyModel } from "@/generated/prisma/models";
import { formatPropertyAddress } from "@/lib/utils";

export function PropertyCard({
  property,
}: {
  property: PropertyModel & { _count?: { items: number; contracts?: number; products?: number } };
}) {
  // #293 — a linked-record count, so it's visible from the list that a
  // property has (or doesn't have) contracts/warranties attached, not just
  // discoverable by opening it.
  const linkedCount = (property._count?.contracts ?? 0) + (property._count?.products ?? 0);

  return (
    <Link
      href={`/home/${property.id}`}
      className="block min-w-0 rounded-lg border border-border bg-surface p-4 shadow-stripe transition hover:border-accent/50"
    >
      <div className="min-w-0">
        <p className="truncate text-sm text-muted">
          {formatPropertyAddress(property) || "No address set"}
        </p>
        <p className="truncate font-medium">{property.label}</p>
      </div>

      {property._count != null && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted">
          <span className="tabular-nums">{linkedCount} linked</span>
          <span className="tabular-nums">
            {property._count.items} {property._count.items === 1 ? "item" : "items"}
          </span>
        </div>
      )}
    </Link>
  );
}
