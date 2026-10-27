import Link from "next/link";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { ASSET_CLASS_LABELS } from "@/lib/validation/wealth";
import type { HoldingValue } from "@/lib/wealth";

interface Props {
  holding: HoldingValue;
  portfolioId: string;
  region?: string;
}

export function HoldingCard({ holding, portfolioId, region }: Props) {
  const isPositive = (holding.gainLoss ?? 0) >= 0;
  const hasValue = holding.currentValue != null;

  return (
    <Link
      href={`/wealth/portfolios/${portfolioId}/holdings/${holding.holdingId}`}
      className="block rounded-xl border border-border bg-surface p-4 hover:border-accent/50 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold truncate">{holding.ticker}</p>
          {holding.name && (
            <p className="text-xs text-muted truncate">{holding.name}</p>
          )}
        </div>
        <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
          {ASSET_CLASS_LABELS[holding.assetClass] ?? holding.assetClass}
        </span>
      </div>

      {/* #403 — min-w-0 lets the grid cells shrink (they default to min-width:auto);
          formatted amounts join the code with a no-break space, so the dd's also
          need flex-wrap/wrap-anywhere to break instead of overflowing the card. */}
      <dl className="mt-3 grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <dt className="text-xs text-muted">Units</dt>
          <dd className="text-sm font-medium">{formatNumber(holding.unitsHeld, region)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted">Current price</dt>
          <dd className="flex flex-wrap items-center gap-1 text-sm font-medium wrap-anywhere">
            {holding.currentPrice != null
              ? formatCurrency(holding.currentPrice, holding.currency, undefined, region, { showCode: true })
              : <span className="text-muted">—</span>}
            {holding.changePct != null && (
              <span className={`text-xs ${holding.changePct >= 0 ? "text-success" : "text-danger"}`}>
                {holding.changePct >= 0 ? "+" : ""}{holding.changePct.toFixed(2)}%
              </span>
            )}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted">Market value</dt>
          <dd className="text-sm font-medium wrap-anywhere">
            {hasValue ? formatCurrency(holding.currentValue!, holding.currency, undefined, region, { showCode: true }) : "—"}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted">Gain / loss</dt>
          <dd className={`flex flex-wrap items-center gap-0.5 text-sm font-medium wrap-anywhere ${hasValue ? (isPositive ? "text-success" : "text-danger") : "text-muted"}`}>
            {hasValue ? (
              <>
                {isPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                {isPositive ? "+" : ""}
                {formatCurrency(holding.gainLoss!, holding.currency, undefined, region, { showCode: true })}
                {holding.gainLossPct != null && (
                  <span className="ml-1 text-xs">
                    ({isPositive ? "+" : ""}{holding.gainLossPct.toFixed(1)}%)
                  </span>
                )}
              </>
            ) : (
              <><Minus size={12} />—</>
            )}
          </dd>
        </div>
      </dl>
    </Link>
  );
}
