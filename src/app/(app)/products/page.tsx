import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getUserPreferences } from "@/lib/userPreferences";
import { ProductListClient } from "@/components/ProductListClient";
import type { Prisma } from "@/generated/prisma/client";
import { isModuleEnabled } from "@/lib/modules/enablement";
import { warrantyDueCounts, warrantyDueFilter } from "@/lib/listDue";
import { getDueContext } from "@/lib/appSettings";
import type { DueContext } from "@/lib/duePolicy";
import {
  hasListFilters,
  legacyListRedirect,
  warrantyLapsedRedirect,
  parseListFilters,
  productFilterWheres,
  productRules,
  type ListFilterCounts,
} from "@/lib/recordFilters";
import { canWrite as sessionCanWrite } from "@/lib/readOnly";

export const metadata: Metadata = { title: "Purchases & warranties" };

function first(value: string | string[] | undefined): string | undefined {
  return (Array.isArray(value) ? value[0] : value) || undefined;
}

// Household-wide chip counts from the same rules the list uses (#395).
async function warrantyCounts(now: Date, ctx: DueContext): Promise<ListFilterCounts> {
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const [{ dueSoon, lapsed }, review, noDocument, missingDetails, important, recentlyAdded] = await Promise.all([
    warrantyDueCounts(ctx),
    prisma.product.count({ where: productRules.review.where }),
    prisma.product.count({ where: productRules.noDocument.where }),
    prisma.product.count({ where: productRules.missingDetails.where }),
    prisma.product.count({ where: productRules.important.where }),
    prisma.product.count({ where: { deletedAt: null, createdAt: { gte: weekAgo } } }),
  ]);
  return { dueSoon, lapsed, review, noDocument, missingDetails, important, recentlyAdded };
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
  // #384 — the Lapsed chip was `?due=overdue`; a Lapsed Warranty is never Due.
  const lapsedLink = warrantyLapsedRedirect(params);
  if (lapsedLink) redirect(lapsedLink);

  const q = first(params.q);
  const filters = parseListFilters(params);
  const now = new Date();
  // The Due policy decides the filter, the counts and every card's badge (ADR 0002).
  const due = await getDueContext(now);

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
  // `?due=soon` is a Warranty ending inside its due-soon window; `?due=lapsed`
  // is one past its end date (the "Lapsed" chip). The query narrows roughly
  // and the policy decides.
  const dueFilter = filters.due ? warrantyDueFilter(filters.due, due) : null;
  if (dueFilter) and.push(dueFilter.where);
  and.push(...productFilterWheres(filters));

  const [allProducts, counts, inventoryEnabled, { dateFormat, region }, session] = await Promise.all([
    prisma.product.findMany({
      where: { deletedAt: null, AND: and },
      include: { _count: { select: { documents: { where: { deletedAt: null } } } } },
      orderBy: [{ warrantyEndDate: "asc" }],
    }),
    warrantyCounts(now, due),
    isModuleEnabled("INVENTORY"),
    getUserPreferences(),
    auth(),
  ]);
  const products = dueFilter ? allProducts.filter(dueFilter.matches) : allProducts;
  // Hidden while a list filter is on (see ProductListClient), so not loaded either.
  const inventoryItems = inventoryEnabled && !hasListFilters(filters)
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
      due={due}
      filters={filters}
      q={q}
      dateFormat={dateFormat}
      region={region}
      canWrite={sessionCanWrite(session)}
    />
  );
}
