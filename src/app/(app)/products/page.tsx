import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { restorableFromTrash } from "@/lib/trash";
import { auth } from "@/lib/auth";
import { getUserPreferences } from "@/lib/userPreferences";
import { ProductListClient } from "@/components/ProductListClient";
import type { Prisma } from "@/generated/prisma/client";
import { isModuleEnabled } from "@/lib/modules/enablement";
import { WARRANTY_DUE_SELECT, warrantyDueFilter } from "@/lib/listDue";
import { getDueContext } from "@/lib/appSettings";
import type { DueContext } from "@/lib/duePolicy";
import {
  hasListFilters,
  legacyListRedirect,
  warrantyLapsedRedirect,
  parseListFilters,
  productFilterWheres,
  filtersForChip,
  type ListFilterCounts,
  type ListFilters,
  type ToggleableFilter,
} from "@/lib/recordFilters";
import { canWrite as sessionCanWrite } from "@/lib/readOnly";

export const metadata: Metadata = { title: "Warranties" };

function first(value: string | string[] | undefined): string | undefined {
  return (Array.isArray(value) ? value[0] : value) || undefined;
}

// The chips the Warranties list shows (ProductListClient's CHIPS).
const WARRANTY_CHIPS: ToggleableFilter[] = ["dueSoon", "lapsed", "review", "noDocument", "missingDetails", "important"];

// The list's query for a search and a set of filters. `?due=soon` is a
// Warranty ending inside its due-soon window; `?due=lapsed` is one past its
// end date (the "Lapsed" chip). The query narrows roughly and the Due policy
// decides (ADR 0002).
function warrantyListQuery(q: string | undefined, filters: ListFilters, due: DueContext) {
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
  const dueFilter = filters.due ? warrantyDueFilter(filters.due, due) : null;
  if (dueFilter) and.push(dueFilter.where);
  and.push(...productFilterWheres(filters));
  return { where: { deletedAt: null, AND: and } satisfies Prisma.ProductWhereInput, dueFilter };
}

// #517 review — each chip's count is the length of the list it opens from
// here: the current search and other chips kept.
async function warrantyCounts(q: string | undefined, filters: ListFilters, due: DueContext): Promise<ListFilterCounts> {
  const entries = await Promise.all(
    WARRANTY_CHIPS.map(async (chip) => {
      const { where, dueFilter } = warrantyListQuery(q, filtersForChip(filters, chip), due);
      const count = dueFilter
        ? (await prisma.product.findMany({ where, select: WARRANTY_DUE_SELECT })).filter(dueFilter.matches).length
        : await prisma.product.count({ where });
      return [chip, count] as const;
    }),
  );
  return Object.fromEntries(entries);
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

  const { where, dueFilter } = warrantyListQuery(q, filters, due);

  const [allProducts, counts, inventoryEnabled, { dateFormat, region }, session, trashCount] = await Promise.all([
    prisma.product.findMany({
      where,
      include: { _count: { select: { documents: { where: { deletedAt: null } } } } },
      orderBy: [{ warrantyEndDate: "asc" }],
    }),
    warrantyCounts(q, filters, due),
    isModuleEnabled("INVENTORY"),
    getUserPreferences(),
    auth(),
    // #514 review — an empty list says how many are in Trash.
    prisma.product.count({ where: restorableFromTrash() }),
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
      trashCount={trashCount}
    />
  );
}
