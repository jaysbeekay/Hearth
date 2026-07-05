import Link from "next/link";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { ASSET_CLASS_LABELS } from "@/lib/validation/wealth";
import type { HoldingValue } from "@/lib/wealth";

interface Props {
  holding: HoldingValue;
  portfolioId: string;
}

export function HoldingCard({ holding, portfolioId }: Props) {
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
            <p className="text-xs text-foreground/60 truncate">{holding.name}</p>
          )}
        </div>
        <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
          {ASSET_CLASS_LABELS[holding.assetClass] ?? holding.assetClass}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <dt className="text-xs text-foreground/50">Units</dt>
          <dd className="text-sm font-medium tabular-nums">{holding.unitsHeld.toLocaleString("en-AU", { maximumFractionDigits: 6 })}</dd>
        </div>
        <div>
          <dt className="text-xs text-foreground/50">Current price</dt>
          <dd className="flex items-center gap-1 text-sm font-medium tabular-nums">
            {holding.currentPrice != null
              ? formatCurrency(holding.currentPrice, holding.currency)
              : <span className="text-foreground/40">—</span>}
            {holding.changePct != null && (
              <span className={`text-xs ${holding.changePct >= 0 ? "text-success" : "text-danger"}`}>
                {holding.changePct >= 0 ? "+" : ""}{holding.changePct.toFixed(2)}%
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-foreground/50">Market value</dt>
          <dd className="text-sm font-medium tabular-nums">
            {hasValue ? formatCurrency(holding.currentValue!, holding.currency) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-foreground/50">Gain / loss</dt>
          <dd className={`flex items-center gap-0.5 text-sm font-medium tabular-nums ${hasValue ? (isPositive ? "text-success" : "text-danger") : "text-foreground/40"}`}>
            {hasValue ? (
              <>
                {isPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                {isPositive ? "+" : ""}
                {formatCurrency(holding.gainLoss!, holding.currency)}
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
