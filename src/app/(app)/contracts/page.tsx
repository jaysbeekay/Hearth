import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getUserPreferences } from "@/lib/userPreferences";
import { ContractListClient } from "@/components/ContractListClient";
import { contractDueFilter } from "@/lib/listDue";
import {
  contractFilterWheres,
  contractRules,
  legacyListRedirect,
  parseListFilters,
  type ListFilterCounts,
} from "@/lib/recordFilters";
import type { Prisma } from "@/generated/prisma/client";
import { ContractCategory, ContractStatus } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Policies & contracts" };

function first(value: string | string[] | undefined): string | undefined {
  return (Array.isArray(value) ? value[0] : value) || undefined;
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return (allowed as readonly string[]).includes(value ?? "") ? (value as T) : undefined;
}

// Chip counts for the whole household (not narrowed by search text or other
// chips), from the same rules the list uses, so each count is the length of
// the list its chip opens.
async function contractCounts(now: Date): Promise<ListFilterCounts> {
  const soon = contractDueFilter("soon", now);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const [soonCandidates, overdue, review, noDocument, missingDetails, important, recentlyAdded] =
    await Promise.all([
      prisma.contract.findMany({
        where: soon.where,
        select: { deletedAt: true, status: true, endDate: true, noticePeriodDays: true, renewalType: true },
      }),
      prisma.contract.count({ where: contractDueFilter("overdue", now).where }),
      prisma.contract.count({ where: contractRules.review.where }),
      prisma.contract.count({ where: contractRules.noDocument.where }),
      prisma.contract.count({ where: contractRules.missingDetails.where }),
      prisma.contract.count({ where: contractRules.important.where }),
      prisma.contract.count({ where: { deletedAt: null, createdAt: { gte: weekAgo } } }),
    ]);
  return {
    dueSoon: soonCandidates.filter(soon.matches).length,
    overdue,
    review,
    noDocument,
    missingDetails,
    important,
    recentlyAdded,
  };
}

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // #395 — pre-#395 links (?expiring=30, ?missingInfo=true…) land on the same filter.
  const legacy = legacyListRedirect("/contracts", params);
  if (legacy) redirect(legacy);

  const q = first(params.q);
  // An unknown category/status (a hand-edited URL) is ignored, not sent to Prisma.
  const category = oneOf(first(params.category), Object.values(ContractCategory));
  const status = oneOf(first(params.status), Object.values(ContractStatus));
  const filters = parseListFilters(params);
  const now = new Date();

  const and: Prisma.ContractWhereInput[] = [];
  if (category) and.push({ category });
  if (status) and.push({ status });
  if (q) {
    and.push({
      OR: [{ title: { contains: q } }, { provider: { contains: q } }, { contractNumber: { contains: q } }],
    });
  }
  // Due needs notice deadlines, which SQL can't express: the query narrows
  // roughly and `due.matches` decides (ADR 0002).
  const due = filters.due ? contractDueFilter(filters.due, now) : null;
  if (due) and.push(due.where);
  and.push(...contractFilterWheres(filters));

  const [allContracts, counts, { dateFormat, region }, session] = await Promise.all([
    prisma.contract.findMany({
      where: { deletedAt: null, AND: and },
      include: { _count: { select: { documents: { where: { deletedAt: null } } } } },
      orderBy: [{ status: "asc" }, { endDate: "asc" }],
    }),
    contractCounts(now),
    getUserPreferences(),
    auth(),
  ]);
  const contracts = due ? allContracts.filter(due.matches) : allContracts;

  return (
    <ContractListClient
      contracts={contracts}
      counts={counts}
      filters={filters}
      q={q}
      category={category}
      status={status}
      dateFormat={dateFormat}
      region={region}
      canWrite={session?.user.role !== "READONLY"}
    />
  );
}
