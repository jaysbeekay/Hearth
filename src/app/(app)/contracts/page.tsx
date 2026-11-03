import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { restorableFromTrash } from "@/lib/trash";
import { auth } from "@/lib/auth";
import { getUserPreferences } from "@/lib/userPreferences";
import { ContractListClient } from "@/components/ContractListClient";
import { CONTRACT_DUE_SELECT, contractDueFilter } from "@/lib/listDue";
import { getDueContext } from "@/lib/appSettings";
import type { DueContext } from "@/lib/duePolicy";
import {
  contractFilterWheres,
  filtersForChip,
  legacyListRedirect,
  parseListFilters,
  type ListFilterCounts,
  type ListFilters,
  type ToggleableFilter,
} from "@/lib/recordFilters";

// The chips the Contracts list shows (ContractListClient's CHIPS).
const CONTRACT_CHIPS: ToggleableFilter[] = ["dueSoon", "overdue", "review", "noDocument", "missingDetails", "important"];
import type { Prisma } from "@/generated/prisma/client";
import { ContractCategory, ContractStatus } from "@/generated/prisma/enums";
import { canWrite as sessionCanWrite } from "@/lib/readOnly";

export const metadata: Metadata = { title: "Contracts" };

function first(value: string | string[] | undefined): string | undefined {
  return (Array.isArray(value) ? value[0] : value) || undefined;
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return (allowed as readonly string[]).includes(value ?? "") ? (value as T) : undefined;
}

interface ContractQuery {
  q?: string;
  category?: ContractCategory;
  status?: ContractStatus;
}

// The list's query for a set of filters: what Prisma narrows, and the Due
// policy's final say when a due chip is on (ADR 0002).
function contractListQuery({ q, category, status }: ContractQuery, filters: ListFilters, due: DueContext) {
  const and: Prisma.ContractWhereInput[] = [];
  if (category) and.push({ category });
  if (status) and.push({ status });
  if (q) {
    and.push({
      OR: [{ title: { contains: q } }, { provider: { contains: q } }, { contractNumber: { contains: q } }],
    });
  }
  const dueFilter = filters.due ? contractDueFilter(filters.due, due) : null;
  if (dueFilter) and.push(dueFilter.where);
  and.push(...contractFilterWheres(filters));
  return { where: { deletedAt: null, AND: and } satisfies Prisma.ContractWhereInput, dueFilter };
}

// #517 review — each chip's count is the length of the list it opens from
// here: the current search, category, status and other chips kept. Built
// from the same query as the list, so the two always agree.
async function contractCounts(query: ContractQuery, filters: ListFilters, due: DueContext): Promise<ListFilterCounts> {
  const entries = await Promise.all(
    CONTRACT_CHIPS.map(async (chip) => {
      const { where, dueFilter } = contractListQuery(query, filtersForChip(filters, chip), due);
      const count = dueFilter
        ? (await prisma.contract.findMany({ where, select: CONTRACT_DUE_SELECT })).filter(dueFilter.matches).length
        : await prisma.contract.count({ where });
      return [chip, count] as const;
    }),
  );
  return Object.fromEntries(entries);
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
  // The household's today and default Reminder thresholds: the Due policy
  // decides the filter, the counts and every card's badge (ADR 0002).
  const due = await getDueContext(now);

  const query = { q, category, status };
  const { where, dueFilter } = contractListQuery(query, filters, due);

  const [allContracts, counts, { dateFormat, region }, session, trashCount] = await Promise.all([
    prisma.contract.findMany({
      where,
      include: {
        _count: { select: { documents: { where: { deletedAt: null } } } },
        vehicle: { select: { label: true } },
      },
      orderBy: [{ status: "asc" }, { endDate: "asc" }],
    }),
    contractCounts(query, filters, due),
    getUserPreferences(),
    auth(),
    // #514 review — an empty list says how many are in Trash.
    prisma.contract.count({ where: restorableFromTrash() }),
  ]);
  const contracts = dueFilter ? allContracts.filter(dueFilter.matches) : allContracts;

  return (
    <ContractListClient
      contracts={contracts}
      counts={counts}
      due={due}
      filters={filters}
      q={q}
      category={category}
      status={status}
      dateFormat={dateFormat}
      region={region}
      canWrite={sessionCanWrite(session)}
      trashCount={trashCount}
    />
  );
}
