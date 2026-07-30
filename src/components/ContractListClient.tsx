"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { linkButtonClass, toolbarButtonClass, exportMenuItemClass } from "@/lib/buttonStyles";
import { useRouter } from "next/navigation";
import { Plus, ChevronDown, X, Trash2 } from "lucide-react";
import { SelectWrapper } from "@/components/SelectWrapper";
import { ContractCard } from "@/components/ContractCard";
import { PendingRecordCard } from "@/components/PendingRecordCard";
import { SwipeableListItem } from "@/components/SwipeableListItem";
import { ConfirmForm } from "@/components/ConfirmForm";
import { deleteContract } from "@/lib/actions/contracts";
import type { ContractModel } from "@/generated/prisma/models";
import { CATEGORY_LABELS } from "@/lib/utils";
import { cachePageData } from "@/lib/offlineCache";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { usePendingCreates } from "@/lib/usePendingCreates";

const STATUS_LABELS: Record<string, string> = { ACTIVE: "Active", CANCELLED: "Cancelled" };

interface Props {
  contracts: ContractModel[];
  q?: string;
  category?: string;
  status?: string;
  dateFormat?: string;
  region?: string;
  canWrite?: boolean;
}

export function ContractListClient({
  contracts,
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
    const params = new URLSearchParams();
    if (key !== "q" && q) params.set("q", q);
    if (key !== "category" && category) params.set("category", category);
    if (key !== "status" && status) params.set("status", status);
    router.push(`/contracts${params.toString() ? `?${params.toString()}` : ""}`);
  }

  useEffect(() => {
    cachePageData("contracts:list", contracts).catch(() => {});
  }, [contracts]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Contracts</h1>
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

      {(q || category || status) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">
            {contracts.length} {contracts.length === 1 ? "contract" : "contracts"}
          </span>
          {q && (
            <button
              type="button"
              onClick={() => removeFilter("q")}
              className="flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-xs hover:bg-black/5 dark:hover:bg-white/5"
            >
              &quot;{q}&quot; <X size={12} />
            </button>
          )}
          {category && (
            <button
              type="button"
              onClick={() => removeFilter("category")}
              className="flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-xs hover:bg-black/5 dark:hover:bg-white/5"
            >
              {CATEGORY_LABELS[category] ?? category} <X size={12} />
            </button>
          )}
          {status && (
            <button
              type="button"
              onClick={() => removeFilter("status")}
              className="flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-xs hover:bg-black/5 dark:hover:bg-white/5"
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
          <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-foreground/60">
            {q || category || status
              ? "No contracts match your search or filters."
              : "No contracts yet. Add one manually, or upload a PDF and we'll fill in the details."}
          </p>
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
                    confirmText={`Delete this contract and all its documents? This cannot be undone.`}
                    ariaLabel={`Delete ${contract.title}`}
                    className="flex h-full w-full flex-col items-center justify-center gap-1 bg-danger text-xs font-medium text-white"
                    offline={{ entity: "contract", entityId: contract.id, label: `Delete contract: ${contract.title}` }}
                  >
                    <Trash2 size={18} />
                    Delete
                  </ConfirmForm>
                }
              >
                <ContractCard contract={contract} dateFormat={dateFormat} region={region} />
              </SwipeableListItem>
            ) : (
              <ContractCard key={contract.id} contract={contract} dateFormat={dateFormat} region={region} />
            ),
          )}
        </div>
      )}
    </div>
  );
}
