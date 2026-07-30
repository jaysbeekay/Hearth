import Link from "next/link";
import type { PropertyModel } from "@/generated/prisma/models";
import { formatPropertyAddress } from "@/lib/utils";

export function PropertyCard({
  property,
}: {
  property: PropertyModel & { _count?: { items: number } };
}) {
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
        <div className="mt-3 flex items-center justify-end text-sm text-muted">
          <span className="tabular-nums">
            {property._count.items} {property._count.items === 1 ? "item" : "items"}
          </span>
        </div>
      )}
    </Link>
  );
}
