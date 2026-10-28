import Link from "next/link";
import type { ContractModel } from "@/generated/prisma/models";
import { ExpiryBadge } from "@/components/ExpiryBadge";
import { contractDue, headlineEntry, type DueContext } from "@/lib/dueRecords";
import {
  CATEGORY_LABELS,
  BILLING_LABELS,
  formatCurrency,
  formatDate,
} from "@/lib/utils";

export function ContractCard({
  contract,
  due,
  dateFormat,
  region,
  missing,
}: {
  contract: ContractModel & { _count?: { documents: number } };
  /** #384 — the household's today and default thresholds, for the Due policy. */
  due: DueContext;
  dateFormat?: string;
  region?: string;
  /** #395 — which key details are missing, shown when the list is filtered to them. */
  missing?: string[];
}) {
  const entry = headlineEntry(contractDue(contract, due));
  const cancelled = contract.status === "CANCELLED";
  const categoryLabel = CATEGORY_LABELS[contract.category] ?? contract.category;

  return (
    <Link
      href={`/contracts/${contract.id}`}
      className="block min-w-0 rounded-lg border border-border bg-surface p-4 transition hover:border-accent/50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* #403 — two clamped lines in a fixed-height slot (min-h-10 = 2 × the
              text-sm line box) so long categories read in full and every card's
              header stays the same height. */}
          <p className="line-clamp-2 min-h-10 text-sm text-muted" title={categoryLabel}>
            {categoryLabel}
          </p>
          <p className="truncate font-medium">{contract.title}</p>
          <p className="truncate text-sm text-muted">{contract.provider}</p>
        </div>
        <ExpiryBadge entry={entry} cancelled={cancelled} />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 text-sm text-muted">
        <span className="min-w-0 truncate">
          {contract.endDate ? `Ends ${formatDate(contract.endDate, dateFormat)}` : "No end date"}
        </span>
        {contract.cost != null && (
          <span className="shrink-0 whitespace-nowrap">
            {formatCurrency(contract.cost, contract.currency, undefined, region)}
            {contract.billingFrequency ? ` / ${BILLING_LABELS[contract.billingFrequency]?.toLowerCase()}` : ""}
          </span>
        )}
      </div>

      {missing && missing.length > 0 && (
        <p className="mt-1 text-xs font-medium text-warning">{missing.join(" · ")}</p>
      )}

      {contract._count != null && contract._count.documents > 0 && (
        <p className="mt-1 text-xs text-muted">
          {contract._count.documents} {contract._count.documents === 1 ? "doc" : "docs"}
        </p>
      )}
    </Link>
  );
}
