"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
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
import { deleteContract } from "@/lib/actions/contracts";
import type { ContractModel } from "@/generated/prisma/models";
import { CATEGORY_LABELS, daysUntil } from "@/lib/utils";
import { cachePageData } from "@/lib/offlineCache";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { usePendingCreates } from "@/lib/usePendingCreates";

const STATUS_LABELS: Record<string, string> = { ACTIVE: "Active", CANCELLED: "Cancelled" };

interface Props {
  contracts: ContractModel[];
  q?: string;
  category?: string;
  status?: string;
  expiring?: string;
  expired?: string;
  needsReview?: string;
  missingDocument?: string;
  dateFormat?: string;
  region?: string;
  canWrite?: boolean;
}

export function ContractListClient({
  contracts,
  q,
  category,
  status,
  expiring,
  expired,
  needsReview,
  missingDocument,
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
    if (expiring) params.set("expiring", expiring);
    if (expired) params.set("expired", expired);
    if (needsReview) params.set("needsReview", needsReview);
    if (missingDocument) params.set("missingDocument", missingDocument);
    router.push(`/contracts${params.toString() ? `?${params.toString()}` : ""}`);
  }

  // #207 — completeness filter chips. expiring/expired are mutually
  // exclusive (clicking one clears the other); needsReview/missingDocument
  // are independent and can be combined with any other filter.
  const toggleCompletenessFilter = useCallback(
    (key: "expiring" | "expired" | "needsReview" | "missingDocument", value: string) => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (category) params.set("category", category);
      if (status) params.set("status", status);
      if (expiring) params.set("expiring", expiring);
      if (expired) params.set("expired", expired);
      if (needsReview) params.set("needsReview", needsReview);
      if (missingDocument) params.set("missingDocument", missingDocument);

      const isActive = params.get(key) === value;
      if (key === "expiring" || key === "expired") {
        params.delete("expiring");
        params.delete("expired");
      }
      if (!isActive) params.set(key, value);
      else params.delete(key);
      router.push(`/contracts${params.toString() ? `?${params.toString()}` : ""}`);
    },
    [q, category, status, expiring, expired, needsReview, missingDocument, router],
  );

  useEffect(() => {
    cachePageData("contracts:list", contracts).catch(() => {});
  }, [contracts]);

  const filtered = Boolean(
    q || category || status || expiring || expired || needsReview || missingDocument,
  );
  const summary = useMemo(() => {
    let expiringSoon = 0;
    let expired = 0;
    let recentlyAdded = 0;
    let needsReview = 0;
    const weekAgo = new Date().getTime() - 7 * 86_400_000;
    for (const contract of contracts) {
      if (contract.status === "ACTIVE") {
        const days = daysUntil(contract.endDate);
        if (days != null && days < 0) expired++;
        else if (days != null && days <= 30) expiringSoon++;
      }
      if (new Date(contract.createdAt).getTime() >= weekAgo) recentlyAdded++;
      if (contract.extractionPending) needsReview++;
    }
    return [
      {
        label: "expiring within 30 days",
        value: expiringSoon,
        tone: "warning" as const,
        onClick: () => toggleCompletenessFilter("expiring", "30"),
      },
      {
        label: "expired",
        value: expired,
        tone: "danger" as const,
        onClick: () => toggleCompletenessFilter("expired", "true"),
      },
      {
        label: "needs review",
        value: needsReview,
        tone: "warning" as const,
        onClick: () => toggleCompletenessFilter("needsReview", "true"),
      },
      { label: "added this week", value: recentlyAdded },
    ];
  }, [contracts, toggleCompletenessFilter]);

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

      <div className="flex flex-wrap gap-2 text-sm">
        {[
          { key: "expiring" as const, value: "30", label: "Expiring soon", active: expiring === "30" },
          { key: "expired" as const, value: "true", label: "Expired", active: expired === "true" },
          { key: "needsReview" as const, value: "true", label: "Needs review", active: needsReview === "true" },
          {
            key: "missingDocument" as const,
            value: "true",
            label: "Missing document",
            active: missingDocument === "true",
          },
        ].map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => toggleCompletenessFilter(chip.key, chip.value)}
            aria-pressed={chip.active}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              chip.active
                ? "border-accent bg-accent/10 text-accent"
                : "border-border bg-surface text-muted hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {filtered && (
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
            <p className="text-sm text-foreground/60">
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
