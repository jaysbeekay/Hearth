import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Trash2, Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDate } from "@/lib/utils";
import { refreshPricesForTickers, getPriceMap, fetchAndStorePriceHistory, getPriceHistory } from "@/lib/prices";
import { deleteHolding, deleteTrade, addTradeDocument, deleteTradeDocumentAction } from "@/lib/actions/wealth";
import { ConfirmForm } from "@/components/ConfirmForm";
import { DocumentUploadForm } from "@/components/DocumentUploadForm";
import { ASSET_CLASS_LABELS, TRADE_TYPE_LABELS } from "@/lib/validation/wealth";
import { getUserPreferences } from "@/lib/userPreferences";

export const metadata: Metadata = { title: "Holding" };

function holdingUnitsAndCost(trades: { type: string; units: number; pricePerUnit: number; fees: number | null }[]) {
  let units = 0;
  let cost = 0;
  for (const t of trades) {
    if (t.type === "BUY") {
      units += t.units;
      cost += t.units * t.pricePerUnit + (t.fees ?? 0);
    } else if (t.type === "SELL") {
      const sellUnits = Math.min(t.units, units);
      if (units > 0) cost = cost * ((units - sellUnits) / units);
      units = Math.max(0, units - sellUnits);
    } else if (t.type === "SPLIT") {
      units += t.units;
    }
  }
  return { units, cost };
}

/** Running units held at or before a given timestamp. Trades must be sorted ascending by date. */
function unitsAtTime(
  sortedTrades: { type: string; units: number; date: Date }[],
  atMs: number,
): number {
  let units = 0;
  for (const t of sortedTrades) {
    if (t.date.getTime() > atMs) break;
    if (t.type === "BUY") units += t.units;
    else if (t.type === "SELL") units = Math.max(0, units - t.units);
    else if (t.type === "SPLIT") units += t.units;
  }
  return units;
}

interface SvgChartProps {
  points: { date: Date; value: number }[];
  currency: string;
  dateFormat?: string;
}

function PerformanceChart({ points, currency, dateFormat }: SvgChartProps) {
  if (points.length < 2) return null;

  const W = 600;
  const H = 160;
  const PAD = { top: 12, right: 8, bottom: 28, left: 56 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const minT = points[0].date.getTime();
  const maxT = points[points.length - 1].date.getTime();
  const values = points.map((p) => p.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const vRange = maxV - minV || 1;

  function px(p: { date: Date; value: number }) {
    return {
      x: PAD.left + ((p.date.getTime() - minT) / (maxT - minT)) * innerW,
      y: PAD.top + innerH - ((p.value - minV) / vRange) * innerH,
    };
  }

  const coords = points.map(px);
  const polyline = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");

  // area fill — close path along bottom
  const areaPath =
    `M ${coords[0].x.toFixed(1)},${(PAD.top + innerH).toFixed(1)} ` +
    coords.map((c) => `L ${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ") +
    ` L ${coords[coords.length - 1].x.toFixed(1)},${(PAD.top + innerH).toFixed(1)} Z`;

  const lastPoint = points[points.length - 1];
  const firstPoint = points[0];
  const isPositive = lastPoint.value >= firstPoint.value;
  const lineColor = isPositive ? "var(--color-success)" : "var(--color-danger)";

  // Y-axis labels (4 ticks)
  const yTicks = [0, 0.33, 0.67, 1].map((f) => ({
    value: minV + f * vRange,
    y: PAD.top + innerH - f * innerH,
  }));

  // X-axis labels (first + last + any year boundary in between)
  const xLabels: { label: string; x: number }[] = [];
  xLabels.push({ label: formatDate(firstPoint.date, dateFormat).slice(0, 7), x: PAD.left });
  xLabels.push({
    label: formatDate(lastPoint.date, dateFormat).slice(0, 7),
    x: PAD.left + innerW,
  });

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      style={{ height: H, overflow: "visible" }}
      aria-label="Portfolio value over time"
    >
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.18" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* grid lines */}
      {yTicks.map((t, i) => (
        <line
          key={i}
          x1={PAD.left}
          y1={t.y}
          x2={PAD.left + innerW}
          y2={t.y}
          stroke="currentColor"
          strokeOpacity="0.08"
          strokeWidth="1"
        />
      ))}

      {/* area fill */}
      <path d={areaPath} fill="url(#areaGrad)" />

      {/* price line */}
      <polyline
        points={polyline}
        fill="none"
        stroke={lineColor}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* end-point dot */}
      <circle
        cx={coords[coords.length - 1].x}
        cy={coords[coords.length - 1].y}
        r="3"
        fill={lineColor}
      />

      {/* y-axis labels */}
      {yTicks.map((t, i) => (
        <text
          key={i}
          x={PAD.left - 6}
          y={t.y + 4}
          textAnchor="end"
          fontSize="10"
          fill="currentColor"
          fillOpacity="0.45"
        >
          {formatCurrency(t.value, currency, 0)}
        </text>
      ))}

      {/* x-axis labels */}
      {xLabels.map((l, i) => (
        <text
          key={i}
          x={l.x}
          y={H - 6}
          textAnchor={i === 0 ? "start" : "end"}
          fontSize="10"
          fill="currentColor"
          fillOpacity="0.45"
        >
          {l.label}
        </text>
      ))}
    </svg>
  );
}

export default async function HoldingPage({
  params,
}: {
  params: Promise<{ id: string; hId: string }>;
}) {
  await requireModuleEnabled("WEALTH");
  const session = await auth();
  const { id: portfolioId, hId: holdingId } = await params;

  const [holding, { dateFormat }] = await Promise.all([
    prisma.holding.findUnique({
      where: { id: holdingId },
      include: {
        portfolio: true,
        trades: {
          include: { documents: { orderBy: { uploadedAt: "desc" } } },
          orderBy: { date: "asc" },
        },
      },
    }),
    getUserPreferences(),
  ]);
  if (!holding || holding.portfolio.createdById !== session!.user.id || holding.portfolioId !== portfolioId) {
    notFound();
  }

  await refreshPricesForTickers([{ ticker: holding.ticker, exchange: holding.exchange }]).catch(() => {});
  const priceMap = await getPriceMap([holding.ticker]);
  const priceEntry = priceMap.get(holding.ticker);

  const sortedTrades = [...holding.trades].sort((a, b) => a.date.getTime() - b.date.getTime());

  const { units, cost } = holdingUnitsAndCost(sortedTrades);

  const currentPrice = priceEntry?.price ?? null;
  const currentValue = currentPrice != null && units > 0 ? units * currentPrice : null;
  const gainLoss = currentValue != null ? currentValue - cost : null;
  const gainLossPct = gainLoss != null && cost > 0 ? (gainLoss / cost) * 100 : null;
  const currency = priceEntry?.currency ?? holding.portfolio.currency;

  // Fetch and store price history for the chart (non-blocking — show with whatever is stored)
  const earliestTrade = sortedTrades[0];
  if (earliestTrade && holding.exchange !== "CRYPTO") {
    await fetchAndStorePriceHistory(holding.ticker, holding.exchange, earliestTrade.date).catch(() => {});
  }

  const priceHistory = earliestTrade
    ? await getPriceHistory(holding.ticker, earliestTrade.date)
    : [];

  // Build chart points: for each stored price day, compute units held × price
  const chartPoints = priceHistory
    .map((pt) => ({
      date: pt.date,
      value: unitsAtTime(sortedTrades, pt.date.getTime()) * pt.price,
    }))
    .filter((pt) => pt.value > 0);

  const tradesDesc = [...holding.trades].sort((a, b) => b.date.getTime() - a.date.getTime());

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href={`/wealth/portfolios/${portfolioId}`} className="text-sm text-foreground/60 hover:text-foreground">
          ← {holding.portfolio.name}
        </Link>
        <div className="mt-1 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{holding.ticker}</h1>
            {holding.name && <p className="text-sm text-foreground/60">{holding.name}</p>}
            <p className="mt-0.5 text-xs text-foreground/40">{ASSET_CLASS_LABELS[holding.assetClass] ?? holding.assetClass}{holding.exchange ? ` · ${holding.exchange}` : ""}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/wealth/portfolios/${portfolioId}/holdings/${holdingId}/edit`}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
            >
              <Pencil size={16} />
              Edit
            </Link>
            <ConfirmForm
              action={deleteHolding.bind(null, portfolioId, holdingId)}
              confirmText={`Delete ${holding.ticker} and all its trades? This cannot be undone.`}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-danger hover:bg-danger/10"
            >
              <Trash2 size={16} />
              Delete
            </ConfirmForm>
          </div>
        </div>
      </div>

      {/* Position summary */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-foreground/50">Units held</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {units.toLocaleString("en-AU", { maximumFractionDigits: 6 })}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-foreground/50">Current price</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {currentPrice != null ? formatCurrency(currentPrice, currency) : "—"}
          </p>
          {priceEntry?.changePct != null && (
            <p className={`text-xs tabular-nums ${priceEntry.changePct >= 0 ? "text-success" : "text-danger"}`}>
              {priceEntry.changePct >= 0 ? "+" : ""}{priceEntry.changePct.toFixed(2)}% today
            </p>
          )}
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-foreground/50">Market value</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {currentValue != null ? formatCurrency(currentValue, currency) : "—"}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-foreground/50">Unrealised gain/loss</p>
          <p className={`mt-1 text-lg font-semibold tabular-nums ${gainLoss == null ? "" : gainLoss >= 0 ? "text-success" : "text-danger"}`}>
            {gainLoss != null
              ? `${gainLoss >= 0 ? "+" : ""}${formatCurrency(gainLoss, currency)}`
              : "—"}
          </p>
          {gainLossPct != null && (
            <p className={`text-xs tabular-nums ${gainLossPct >= 0 ? "text-success" : "text-danger"}`}>
              ({gainLossPct >= 0 ? "+" : ""}{gainLossPct.toFixed(1)}%)
            </p>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-4 rounded-xl border border-border bg-surface p-4 md:p-6 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-foreground/50">Cost basis</dt>
          <dd className="text-sm font-medium tabular-nums">{formatCurrency(cost, currency)}</dd>
        </div>
        <div>
          <dt className="text-xs text-foreground/50">Avg cost / unit</dt>
          <dd className="text-sm font-medium tabular-nums">
            {units > 0 && cost > 0 ? formatCurrency(cost / units, currency) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-foreground/50">Trades</dt>
          <dd className="text-sm font-medium">{holding.trades.length}</dd>
        </div>
      </dl>

      {/* Performance chart */}
      {chartPoints.length >= 2 && (
        <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
          <h2 className="mb-4 font-medium">Performance since first purchase</h2>
          <PerformanceChart points={chartPoints} currency={currency} dateFormat={dateFormat} />
        </section>
      )}

      {/* Trade history */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Trade history</h2>
          <Link
            href={`/wealth/portfolios/${portfolioId}/holdings/${holdingId}/trades/new`}
            className="flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
          >
            <Plus size={16} />
            Add trade
          </Link>
        </div>

        {tradesDesc.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-foreground/60">
            No trades yet.
          </p>
        ) : (
          <div className="space-y-3">
            {tradesDesc.map((trade) => {
              const slippage =
                trade.marketPriceOnDate != null
                  ? ((trade.pricePerUnit - trade.marketPriceOnDate) / trade.marketPriceOnDate) * 100
                  : null;

              return (
                <div key={trade.id} className="rounded-xl border border-border bg-surface p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        trade.type === "BUY" ? "bg-success/10 text-success" :
                        trade.type === "SELL" ? "bg-danger/10 text-danger" :
                        "bg-muted/10 text-muted"
                      }`}>
                        {TRADE_TYPE_LABELS[trade.type] ?? trade.type}
                      </span>
                      <div>
                        <p className="text-sm font-medium tabular-nums">
                          {trade.units.toLocaleString("en-AU", { maximumFractionDigits: 6 })} units @ {formatCurrency(trade.pricePerUnit, trade.currency)}
                        </p>
                        <p className="text-xs text-foreground/50">
                          {formatDate(trade.date, dateFormat)}
                          {trade.fees != null && ` · fees ${formatCurrency(trade.fees, trade.currency)}`}
                        </p>
                        {trade.marketPriceOnDate != null && (
                          <p className="mt-0.5 text-xs text-foreground/40">
                            Market close {formatDate(trade.date, dateFormat)}: {formatCurrency(trade.marketPriceOnDate, trade.currency)}
                            {slippage != null && (
                              <span className={`ml-1 ${Math.abs(slippage) < 0.5 ? "text-foreground/40" : slippage > 0 ? "text-danger" : "text-success"}`}>
                                ({slippage > 0 ? "+" : ""}{slippage.toFixed(2)}% vs close)
                              </span>
                            )}
                          </p>
                        )}
                        {trade.notes && <p className="mt-1 text-xs text-foreground/60">{trade.notes}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/wealth/portfolios/${portfolioId}/holdings/${holdingId}/trades/${trade.id}/edit`}
                        className="rounded-lg border border-border p-2 hover:bg-black/5 dark:hover:bg-white/5"
                        title="Edit trade"
                      >
                        <Pencil size={14} />
                      </Link>
                      <ConfirmForm
                        action={deleteTrade.bind(null, holdingId, trade.id)}
                        confirmText="Delete this trade? This can't be undone."
                        ariaLabel={`Delete trade from ${formatDate(trade.date, dateFormat)}`}
                        className="rounded-lg border border-border p-2 text-danger hover:bg-danger/10"
                      >
                        <Trash2 size={14} />
                      </ConfirmForm>
                    </div>
                  </div>

                  <div className="mt-3 border-t border-border pt-3">
                    {trade.documents.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-2">
                        {trade.documents.map((doc) => (
                          <div key={doc.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs">
                            <a
                              href={`/api/wealth/trade-documents/${doc.id}`}
                              download
                              className="text-accent hover:underline truncate max-w-40"
                            >
                              {doc.filename}
                            </a>
                            <ConfirmForm
                              action={deleteTradeDocumentAction.bind(null, holdingId, trade.id, doc.id)}
                              confirmText={`Remove ${doc.filename}? This can't be undone.`}
                              ariaLabel={`Remove ${doc.filename}`}
                              className="rounded p-1 text-danger hover:text-danger/70"
                            >
                              <Trash2 size={12} />
                            </ConfirmForm>
                          </div>
                        ))}
                      </div>
                    )}
                    <DocumentUploadForm action={addTradeDocument.bind(null, holdingId, trade.id)} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
