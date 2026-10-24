import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getUserPreferences } from "@/lib/userPreferences";
import { ProductListClient } from "@/components/ProductListClient";
import type { Prisma } from "@/generated/prisma/client";
import { isModuleEnabled } from "@/lib/modules/enablement";
import { warrantyDueWhere } from "@/lib/listDue";
import {
  legacyListRedirect,
  parseListFilters,
  productFilterWheres,
  productRules,
  type ListFilterCounts,
} from "@/lib/recordFilters";

export const metadata: Metadata = { title: "Purchases & warranties" };

function first(value: string | string[] | undefined): string | undefined {
  return (Array.isArray(value) ? value[0] : value) || undefined;
}

// Household-wide chip counts from the same rules the list uses (#395).
async function warrantyCounts(now: Date): Promise<ListFilterCounts> {
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const [dueSoon, overdue, review, noDocument, missingDetails, important, recentlyAdded] = await Promise.all([
    prisma.product.count({ where: warrantyDueWhere("soon", now) }),
    prisma.product.count({ where: warrantyDueWhere("overdue", now) }),
    prisma.product.count({ where: productRules.review.where }),
    prisma.product.count({ where: productRules.noDocument.where }),
    prisma.product.count({ where: productRules.missingDetails.where }),
    prisma.product.count({ where: productRules.important.where }),
    prisma.product.count({ where: { deletedAt: null, createdAt: { gte: weekAgo } } }),
  ]);
  return { dueSoon, overdue, review, noDocument, missingDetails, important, recentlyAdded };
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // #395 — pre-#395 links (?expiring=30, ?missingInfo=true…) land on the same filter.
  const legacy = legacyListRedirect("/products", params);
  if (legacy) redirect(legacy);

  const q = first(params.q);
  const filters = parseListFilters(params);
  const now = new Date();

  const and: Prisma.ProductWhereInput[] = [];
  if (q) {
    and.push({
      OR: [
        { description: { contains: q } },
        { manufacturer: { contains: q } },
        { model: { contains: q } },
        { vendor: { contains: q } },
        { serialNumber: { contains: q } },
        { barcode: { contains: q } },
      ],
    });
  }
  if (filters.due) and.push(warrantyDueWhere(filters.due, now));
  and.push(...productFilterWheres(filters));

  const [products, counts, inventoryEnabled, { dateFormat, region }, session] = await Promise.all([
    prisma.product.findMany({
      where: { deletedAt: null, AND: and },
      include: { _count: { select: { documents: { where: { deletedAt: null } } } } },
      orderBy: [{ warrantyEndDate: "asc" }],
    }),
    warrantyCounts(now),
    isModuleEnabled("INVENTORY"),
    getUserPreferences(),
    auth(),
  ]);
  const inventoryItems = inventoryEnabled
    ? await prisma.inventoryItem.findMany({
        where: { deletedAt: null },
        include: { _count: { select: { documents: { where: { deletedAt: null } } } } },
        orderBy: { updatedAt: "desc" },
      })
    : [];

  return (
    <ProductListClient
      products={products}
      inventoryItems={inventoryItems}
      inventoryEnabled={inventoryEnabled}
      counts={counts}
      filters={filters}
      q={q}
      dateFormat={dateFormat}
      region={region}
      canWrite={session?.user.role !== "READONLY"}
    />
  );
}
