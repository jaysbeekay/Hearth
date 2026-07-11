import Link from "next/link";
import type { ContractModel } from "@/generated/prisma/models";
import { ExpiryBadge } from "@/components/ExpiryBadge";
import {
  CATEGORY_LABELS,
  BILLING_LABELS,
  daysUntil,
  formatCurrency,
  formatDate,
} from "@/lib/utils";

export function ContractCard({
  contract,
  dateFormat,
}: {
  contract: ContractModel & { _count?: { documents: number } };
  dateFormat?: string;
}) {
  const days = daysUntil(contract.endDate);
  const cancelled = contract.status === "CANCELLED";

  return (
    <Link
      href={`/contracts/${contract.id}`}
      className="block min-w-0 rounded-lg border border-border bg-surface p-4 shadow-stripe transition hover:border-accent/50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-muted">
            {CATEGORY_LABELS[contract.category] ?? contract.category}
          </p>
          <p className="truncate font-medium">{contract.title}</p>
          <p className="truncate text-sm text-muted">{contract.provider}</p>
        </div>
        <ExpiryBadge days={days} cancelled={cancelled} />
      </div>

      <div className="mt-3 flex items-center justify-between text-sm text-muted">
        <span>
          {contract.endDate ? `Ends ${formatDate(contract.endDate, dateFormat)}` : "No end date"}
        </span>
        {contract.cost != null && (
          <span className="tabular-nums">
            {formatCurrency(contract.cost, contract.currency)}
            {contract.billingFrequency ? ` / ${BILLING_LABELS[contract.billingFrequency]?.toLowerCase()}` : ""}
          </span>
        )}
      </div>

      {contract._count != null && contract._count.documents > 0 && (
        <p className="mt-1 text-xs text-muted tabular-nums">
          {contract._count.documents} {contract._count.documents === 1 ? "doc" : "docs"}
        </p>
      )}
    </Link>
  );
}
