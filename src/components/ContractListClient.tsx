"use client";

import { useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { linkButtonClass, toolbarButtonClass, exportMenuItemClass } from "@/lib/buttonStyles";
import { useRouter } from "next/navigation";
import { Plus, ChevronDown, X, Trash2, Upload } from "lucide-react";
import { SelectWrapper } from "@/components/SelectWrapper";
import { ContractCard } from "@/components/ContractCard";
import { PendingRecordCard } from "@/components/PendingRecordCard";
import { SwipeableListItem } from "@/components/SwipeableListItem";
import { ConfirmForm } from "@/components/ConfirmForm";
import { ListSummaryStrip } from "@/components/ListSummaryStrip";
import { ListFilterChips, ListFilterHiddenInputs } from "@/components/ListFilterChips";
import { deleteContract, restoreContract } from "@/lib/actions/contracts";
import type { ContractModel } from "@/generated/prisma/models";
import { CATEGORY_LABELS } from "@/lib/utils";
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

const STATUS_LABELS: Record<string, string> = { ACTIVE: "Active", CANCELLED: "Cancelled" };

const CHIPS: { chip: ToggleableFilter; label: string; onlyWhenActive?: boolean }[] = [
  { chip: "dueSoon", label: "Expiring soon" },
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
      label: "expiring soon",
      value: counts.dueSoon ?? 0,
      tone: "warning" as const,
      onClick: () => {
        toggleFilter("dueSoon");
      },
    },
    {
      label: "expired",
      value: counts.overdue ?? 0,
      tone: "danger" as const,
      onClick: () => {
        toggleFilter("overdue");
      },
    },
    {
      label: "needs review",
      value: counts.review ?? 0,
      tone: "warning" as const,
      onClick: () => {
        toggleFilter("review");
      },
    },
    { label: "added this week", value: counts.recentlyAdded ?? 0 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Policies & contracts</h1>
        <div className="flex items-center gap-2">
          <details className="relative">
            <summary className={toolbarButtonClass}>
              Export <ChevronDown size={14} />
            </summary>
            <div className="absolute right-0 z-10 mt-1 w-28 overflow-hidden rounded-lg border border-border bg-surface shadow-md">
              <a href="/api/export/contracts?format=csv" download className={exportMenuItemClass}>CSV</a>
              <a href="/api/export/contracts?format=pdf" download className={exportMenuItemClass}>PDF</a>
            </div>
          </details>
          {canWrite && (
            <Link
              href="/contracts/new"
              aria-disabled={!online}
              tabIndex={!online ? -1 : undefined}
              className={linkButtonClass("primary", { online })}
            >
              <Plus size={16} />
              Add contract
            </Link>
          )}
        </div>
      </div>

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
          className="flex-1 min-h-11 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-accent"
        />
        <SelectWrapper>
          <select
            name="category"
            defaultValue={category ?? ""}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-accent appearance-none pr-8"
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
            defaultValue={status ?? ""}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-accent appearance-none pr-8"
          >
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </SelectWrapper>
        <button
          type="submit"
          className={toolbarButtonClass}
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
              className="flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-xs hover:bg-hover"
            >
              &quot;{q}&quot; <X size={12} />
            </button>
          )}
          {category && (
            <button
              type="button"
              onClick={() => removeFilter("category")}
              className="flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-xs hover:bg-hover"
            >
              {CATEGORY_LABELS[category] ?? category} <X size={12} />
            </button>
          )}
          {status && (
            <button
              type="button"
              onClick={() => removeFilter("status")}
              className="flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-xs hover:bg-hover"
            >
              {STATUS_LABELS[status] ?? status} <X size={12} />
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
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-10 text-center">
            <p className="text-sm text-muted">
              {filtered
                ? "No contracts match your search or filters."
                : "No contracts yet. Add one manually, or upload a document and we'll fill in the details."}
            </p>
            {!filtered && canWrite && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Link href="/contracts/new" className={linkButtonClass("primary")}>
                  <Plus size={16} />
                  Add contract
                </Link>
                <Link href="/import" className={linkButtonClass("secondary")}>
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
                    confirmText={`Move this contract to Trash? Its documents are kept, and you can restore it within 30 days from Settings → Trash.`}
                    actionLabel="Delete contract"
                    ariaLabel={`Delete ${contract.title}`}
                    className="flex h-full w-full flex-col items-center justify-center gap-1 bg-danger text-xs font-medium text-danger-foreground"
                    offline={{ entity: "contract", entityId: contract.id, label: `Delete contract: ${contract.title}` }}
                  >
                    <Trash2 size={18} />
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
    </div>
  );
}
