"use client";

import { useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { ListPageHeader } from "@/components/ListPageHeader";
import { useRouter } from "next/navigation";
import { Plus, X, Trash2, Upload } from "lucide-react";
import { SelectWrapper } from "@/components/SelectWrapper";
import { ContractCard } from "@/components/ContractCard";
import { PendingRecordCard } from "@/components/PendingRecordCard";
import { SwipeableListItem } from "@/components/SwipeableListItem";
import { ConfirmForm } from "@/components/ConfirmForm";
import { ListSummaryStrip } from "@/components/ListSummaryStrip";
import { ListFilterChips, ListFilterHiddenInputs } from "@/components/ListFilterChips";
import { deleteContract, restoreContract } from "@/lib/actions/contracts";
import type { ContractModel } from "@/generated/prisma/models";
import { CATEGORY_LABELS, cn } from "@/lib/utils";
import type { DueContext } from "@/lib/duePolicy";
import {
  contractMissingParts,
  hasListFilters,
  listHref,
  toggleListFilter,
  type ListFilterCounts,
  type ListFilters,
  type ToggleableFilter,
} from "@/lib/recordFilters";
import { cachePageData } from "@/lib/offlineCache";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { usePendingCreates } from "@/lib/usePendingCreates";
import { buttonClass, chipClass, emptyStateClass, selectClass, inputClass } from "@/lib/ui";
import { PageShell } from "@/components/ui/PageShell";

const STATUS_LABELS = new Map([
  ["ACTIVE", "Active"],
  ["CANCELLED", "Cancelled"],
]);
const CATEGORY_LABEL_MAP = new Map(Object.entries(CATEGORY_LABELS));

const CHIPS: { chip: ToggleableFilter; label: string; onlyWhenActive?: boolean }[] = [
  { chip: "dueSoon", label: "Due soon" },
  { chip: "overdue", label: "Expired" },
  { chip: "review", label: "Needs review" },
  { chip: "noDocument", label: "No document" },
  { chip: "missingDetails", label: "Missing key details" },
  { chip: "important", label: "Important", onlyWhenActive: true },
];

interface Props {
  contracts: ContractModel[];
  /** #395 — household-wide, from the server; never recounted here. */
  counts: ListFilterCounts;
  /** #384 — the household's today and default thresholds, for each card's Due badge. */
  due: DueContext;
  filters: ListFilters;
  q?: string;
  category?: string;
  status?: string;
  dateFormat?: string;
  region?: string;
  canWrite?: boolean;
}

export function ContractListClient({
  contracts,
  counts,
  due,
  filters,
  q,
  category,
  status,
  dateFormat,
  region,
  canWrite = true,
}: Props) {
  const online = useOnlineStatus();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { pendingOps, refresh: refreshPending } = usePendingCreates("contract");

  useEffect(() => {
    const onSyncComplete = () => router.refresh();
    window.addEventListener("offline-sync-complete", onSyncComplete);
    return () => window.removeEventListener("offline-sync-complete", onSyncComplete);
  }, [router]);

  function removeFilter(key: "q" | "category" | "status") {
    router.push(
      listHref("/contracts", filters, {
        q: key === "q" ? undefined : q,
        category: key === "category" ? undefined : category,
        status: key === "status" ? undefined : status,
      }),
    );
  }

  const toggleFilter = useCallback(
    (chip: ToggleableFilter) => {
      router.push(listHref("/contracts", toggleListFilter(filters, chip), { q, category, status }));
    },
    [filters, q, category, status, router],
  );

  useEffect(() => {
    cachePageData("contracts:list", contracts).catch(() => {});
  }, [contracts]);

  const filtered = Boolean(q || category || status || hasListFilters(filters));
  const summary = [
    {
      label: "due soon",
      value: counts.dueSoon ?? 0,
      status: "due-soon" as const,
      onClick: () => {
        toggleFilter("dueSoon");
      },
    },
    {
      label: "expired",
      value: counts.overdue ?? 0,
      status: "overdue" as const,
      onClick: () => {
        toggleFilter("overdue");
      },
    },
    {
      label: "needs review",
      value: counts.review ?? 0,
      status: "needs-review" as const,
      onClick: () => {
        toggleFilter("review");
      },
    },
    { label: "added this week", value: counts.recentlyAdded ?? 0 },
  ];

  return (
    <PageShell width="list">
      <ListPageHeader
        title="Contracts"
        exportPath="/api/export/contracts"
        action={canWrite ? { href: "/contracts/new", label: "Add contract", online } : undefined}
      />

      <form ref={formRef} className="flex flex-col gap-3 md:flex-row" method="GET">
        <ListFilterHiddenInputs filters={filters} />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by title, provider, or number…"
          onChange={() => {
            clearTimeout(searchTimeout.current);
            searchTimeout.current = setTimeout(() => formRef.current?.requestSubmit(), 400);
          }}
          className={cn(inputClass, "flex-1")}
        />
        {/* #403 — w-full on the selects: in the stacked (phone) form the
            SelectWrapper stretches to the row, and a content-sized select left
            the chevron floating outside the box. */}
        <SelectWrapper>
          <select
            name="category"
            aria-label="Filter by category"
            defaultValue={category ?? ""}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className={selectClass}
          >
            <option value="">All categories</option>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </SelectWrapper>
        <SelectWrapper>
          <select
            name="status"
            aria-label="Filter by status"
            defaultValue={status ?? ""}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className={selectClass}
          >
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </SelectWrapper>
        <button
          type="submit"
          className={buttonClass("secondary", {}, "list-none")}
        >
          Filter
        </button>
      </form>

      <ListFilterChips filters={filters} chips={CHIPS} onToggle={toggleFilter} />

      {filtered && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">
            {contracts.length} {contracts.length === 1 ? "contract" : "contracts"}
          </span>
          {q && (
            <button
              type="button"
              onClick={() => removeFilter("q")}
              className={chipClass(true)}
            >
              &quot;{q}&quot; <X size={16} />
            </button>
          )}
          {category && (
            <button
              type="button"
              onClick={() => removeFilter("category")}
              className={chipClass(true)}
            >
              {CATEGORY_LABEL_MAP.get(category) ?? category} <X size={16} />
            </button>
          )}
          {status && (
            <button
              type="button"
              onClick={() => removeFilter("status")}
              className={chipClass(true)}
            >
              {STATUS_LABELS.get(status) ?? status} <X size={16} />
            </button>
          )}
          <button
            type="button"
            onClick={() => router.push("/contracts")}
            className="text-xs text-muted underline hover:text-foreground"
          >
            Clear all
          </button>
        </div>
      )}

      {!filtered && contracts.length > 0 && <ListSummaryStrip items={summary} />}

      {pendingOps.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {pendingOps.map((op) => (
            <PendingRecordCard
              key={op.id}
              op={op}
              title={op.formValues?.title || "Untitled contract"}
              subtitle={op.formValues?.provider}
              editHref={`/contracts/new?pendingOpId=${op.id}`}
              onDeleted={refreshPending}
            />
          ))}
        </div>
      )}

      {contracts.length === 0 ? (
        pendingOps.length === 0 && (
          <div className={emptyStateClass("flex flex-col items-center gap-3")}>
            <p className="text-sm text-muted">
              {filtered
                ? "No contracts match your search or filters."
                : "No contracts yet. Add one manually, or upload a document and we'll fill in the details."}
            </p>
            {!filtered && canWrite && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Link href="/contracts/new" className={buttonClass("primary")}>
                  <Plus size={16} />
                  Add contract
                </Link>
                <Link href="/import" className={buttonClass("secondary")}>
                  <Upload size={16} />
                  Upload a document
                </Link>
              </div>
            )}
          </div>
        )
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {contracts.map((contract) =>
            canWrite ? (
              <SwipeableListItem
                key={contract.id}
                revealAction={
                  <ConfirmForm
                    action={deleteContract.bind(null, contract.id)}
                    undo={{ action: restoreContract.bind(null, contract.id) }}
                    confirmText={`Delete this contract? Its documents are kept, and you can restore it within 30 days from Settings → Recently deleted.`}
                    ariaLabel={`Delete ${contract.title}`}
                    className="flex h-full w-full flex-col items-center justify-center gap-1 bg-danger text-xs font-medium text-danger-foreground"
                    offline={{ entity: "contract", entityId: contract.id, label: `Delete contract: ${contract.title}` }}
                  >
                    <Trash2 size={16} />
                    Delete
                  </ConfirmForm>
                }
              >
                <ContractCard
                  contract={contract}
                  due={due}
                  dateFormat={dateFormat}
                  region={region}
                  missing={filters.missingDetails ? contractMissingParts(contract) : undefined}
                />
              </SwipeableListItem>
            ) : (
              <ContractCard
                key={contract.id}
                contract={contract}
                due={due}
                dateFormat={dateFormat}
                region={region}
                missing={filters.missingDetails ? contractMissingParts(contract) : undefined}
              />
            ),
          )}
        </div>
      )}
    </PageShell>
  );
}
