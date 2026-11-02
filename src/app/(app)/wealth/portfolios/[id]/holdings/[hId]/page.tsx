import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { Pencil, Trash2, Plus } from "lucide-react";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { prisma } from "@/lib/prisma";
import { addDocumentAction } from "@/lib/actions/documents";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { refreshPricesForTickers, getPriceMap, fetchAndStorePriceHistory, getPriceHistory } from "@/lib/prices";
import { deleteHolding, deleteTrade, restoreTrade } from "@/lib/actions/wealth";
import { DocumentList } from "@/components/DocumentList";
import { getTrashedVersionLinks } from "@/lib/documents/trashedVersionLinks";
import { ConfirmForm } from "@/components/ConfirmForm";
import { DetailOverflowMenu } from "@/components/DetailOverflowMenu";
import { DocumentUploadForm } from "@/components/DocumentUploadForm";
import { ASSET_CLASS_LABELS, TRADE_TYPE_LABELS, COST_METHOD_LABELS } from "@/lib/validation/wealth";
import { getUserPreferences } from "@/lib/userPreferences";
import { costUsesTodaysRate, holdingUnitsAndCostIn, valueHolding } from "@/lib/wealth";
import { refreshFxRates, getFxRateMap } from "@/lib/fx";
import { isCryptoHolding, priceCacheKey } from "@/lib/priceSource";
import { auth } from "@/lib/auth";
import { canWrite as sessionCanWrite } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { cardClass, buttonClass, emptyStateClass, menuItemClass } from "@/lib/ui";
import { PageShell } from "@/components/ui/PageShell";

export const metadata: Metadata = { title: "Holding" };

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
  region?: string;
}

function PerformanceChart({ points, currency, dateFormat, region }: SvgChartProps) {
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
          {formatCurrency(t.value, currency, 0, region, { showCode: true })}
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
  const { id: portfolioId, hId: holdingId } = await params;
  const canWrite = sessionCanWrite(await auth());

  const [holding, { dateFormat, region }] = await Promise.all([
    prisma.holding.findUnique({
      where: { id: holdingId },
      include: {
        portfolio: true,
        trades: {
          where: { deletedAt: null },
          include: { documents: { where: { deletedAt: null }, orderBy: { uploadedAt: "desc" } } },
          orderBy: { date: "asc" },
        },
      },
    }),
    getUserPreferences(),
  ]);
  if (!holding || holding.portfolioId !== portfolioId) {
    notFound();
  }

  const trashedLinks = await getTrashedVersionLinks(
    "TRADE",
    holding.trades.map((t) => t.id),
  );

  await refreshPricesForTickers([holding]).catch(() => {});
  const priceMap = await getPriceMap([holding]);
  const priceEntry = priceMap.get(priceCacheKey(holding));
  const crypto = isCryptoHolding(holding);

  const sortedTrades = [...holding.trades].sort((a, b) => a.date.getTime() - b.date.getTime());

  // Price and value are in the price feed's currency; cost basis and
  // gain/loss in the portfolio's, converting each Trade's currency (#404).
  const currency = priceEntry?.currency ?? holding.portfolio.currency;
  const costCurrency = holding.portfolio.currency;
  // Only a BUY's price goes into cost (see holdingUnitsAndCostIn).
  const buyCurrencies = sortedTrades.filter((t) => t.type === "BUY").map((t) => t.currency);
  const fxPairs = [currency, ...buyCurrencies].map((from) => ({ from, to: costCurrency }));
  await refreshFxRates(fxPairs).catch(() => {});
  const rateMap = await getFxRateMap(fxPairs);
  const { units, cost } = holdingUnitsAndCostIn(sortedTrades, holding.portfolio.costMethod, costCurrency, rateMap);
  const todaysRate = cost != null && costUsesTodaysRate(sortedTrades, costCurrency);
  const { currentPrice, currentValue, gainLoss, gainLossPct, unpricedReason } = valueHolding({
    units,
    cost,
    price: priceEntry?.price,
    priceCurrency: currency,
    portfolioCurrency: costCurrency,
    rateMap,
  });

  // #432 — the chart shows whatever history is stored; missing history is
  // fetched after the response is sent, so a slow or hung Yahoo request
  // never holds up the page.
  const earliestTrade = sortedTrades[0];
  // Crypto has no stored history (isCryptoHolding); any rows stored for its
  // ticker came from Yahoo before #404 and are another asset's prices.
  const tracksHistory = Boolean(earliestTrade) && !crypto;
  if (earliestTrade && tracksHistory) {
    const { ticker, exchange, assetClass } = holding;
    after(() => fetchAndStorePriceHistory(ticker, { exchange, assetClass }, earliestTrade.date));
  }

  const priceHistory = earliestTrade && tracksHistory
    ? await getPriceHistory(holding.ticker, earliestTrade.date)
    : [];

  // Build chart points: for each stored price day, compute units held × price
  const chartPoints = priceHistory
    .map((pt) => ({
      date: pt.date,
      value: unitsAtTime(sortedTrades, pt.date.getTime()) * pt.price,
    }))
    .filter((pt) => pt.value > 0);
  // Stored prices can start later than the first Trade: history older than
  // MAX_HISTORY_DAYS, a ticker Yahoo lists from a later date, or a backfill
  // still running.
  const chartStartsLate =
    earliestTrade != null &&
    chartPoints.length >= 2 &&
    chartPoints[0].date.getTime() - earliestTrade.date.getTime() > 7 * 24 * 60 * 60 * 1000;

  const tradesDesc = [...holding.trades].sort((a, b) => b.date.getTime() - a.date.getTime());

  return (
    <PageShell width="detail">
      <div>
        <BackLink href={`/wealth/portfolios/${portfolioId}`} label={holding.portfolio.name} />
        <div className="mt-1 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-medium">{holding.ticker}</h1>
            {holding.name && <p className="text-sm text-muted">{holding.name}</p>}
            <p className="mt-0.5 text-xs text-muted">{ASSET_CLASS_LABELS[holding.assetClass] ?? holding.assetClass}{holding.exchange ? ` · ${holding.exchange}` : ""}</p>
          </div>
          <div className="flex items-center gap-2">
            {canWrite && (
              <>
                <Link
                  href={`/wealth/portfolios/${portfolioId}/holdings/${holdingId}/edit`}
                  className={buttonClass("secondary")}
                >
                  <Pencil size={16} />
                  Edit
                </Link>
                {/* #406 — destructive actions live in the ⋮ menu, as on other record pages. */}
                <DetailOverflowMenu>
                  <ConfirmForm
                    action={deleteHolding.bind(null, portfolioId, holdingId)}
                    confirmText={`Delete ${holding.ticker} and all its trades? This cannot be undone.`}
                    actionLabel={`Delete ${holding.ticker}`}
                    className={menuItemClass({ destructive: true })}
                  >
                    <Trash2 size={16} />
                    Delete
                  </ConfirmForm>
                </DetailOverflowMenu>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Position summary */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <p className="text-xs text-muted">Units held</p>
          <p className="mt-1 text-xl font-medium">
            {formatNumber(units, region)}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-muted">Current price</p>
          <p className="mt-1 text-xl font-medium">
            {currentPrice != null ? formatCurrency(currentPrice, currency, undefined, region, { showCode: true }) : <span className="text-muted">No price</span>}
          </p>
          {currentPrice != null && priceEntry?.changePct != null && (
            <p className={`text-xs ${priceEntry.changePct >= 0 ? "text-success" : "text-danger"}`}>
              {priceEntry.changePct >= 0 ? "+" : ""}{priceEntry.changePct.toFixed(2)}% today
            </p>
          )}
        </Card>
        <Card>
          <p className="text-xs text-muted">Market value</p>
          <p className="mt-1 text-xl font-medium">
            {currentValue != null ? formatCurrency(currentValue, currency, undefined, region, { showCode: true }) : "—"}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-muted">Unrealised gain/loss</p>
          <p className={`mt-1 text-xl font-medium ${gainLoss == null ? "" : gainLoss >= 0 ? "text-success" : "text-danger"}`}>
            {gainLoss != null
              ? `${gainLoss >= 0 ? "+" : ""}${formatCurrency(gainLoss, costCurrency, undefined, region, { showCode: true })}`
              : unpricedReason === "NO_FX"
                ? <span className="text-muted">No exchange rate</span>
                : "—"}
          </p>
          {gainLossPct != null && (
            <p className={`text-xs ${gainLossPct >= 0 ? "text-success" : "text-danger"}`}>
              ({gainLossPct >= 0 ? "+" : ""}{gainLossPct.toFixed(1)}%)
            </p>
          )}
        </Card>
      </div>

      <dl className={cardClass({}, "grid grid-cols-2 gap-4 sm:grid-cols-3")}>
        <div className="min-w-0">
          <dt className="text-xs text-muted">
            Cost basis <span className="text-muted">({COST_METHOD_LABELS[holding.portfolio.costMethod]})</span>
          </dt>
          <dd className="text-sm font-medium break-words">{cost != null ? formatCurrency(cost, costCurrency, undefined, region, { showCode: true }) : <span className="text-muted">No exchange rate</span>}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted">Avg cost / unit</dt>
          <dd className="text-sm font-medium break-words">
            {units > 0 && cost != null && cost > 0 ? formatCurrency(cost / units, costCurrency, undefined, region, { showCode: true }) : "—"}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted">Trades</dt>
          <dd className="text-sm font-medium">{holding.trades.length}</dd>
        </div>
      </dl>
      {todaysRate && (
        <p className="text-xs text-muted">Cost uses today&apos;s exchange rate for trades with no FX rate entered.</p>
      )}

      {/* Performance chart */}
      {chartPoints.length >= 2 && (
        <Card as="section">
          <h2 className="mb-4 font-medium">Performance since first purchase</h2>
          <PerformanceChart points={chartPoints} currency={currency} dateFormat={dateFormat} region={region} />
          {chartStartsLate && (
            <p className="mt-2 text-xs text-muted">Chart shows prices from {formatDate(chartPoints[0].date, dateFormat)}.</p>
          )}
        </Card>
      )}
      {chartPoints.length < 2 && tracksHistory && holding.trades.length > 0 && units > 0 && (
        <p className="text-sm text-muted">No price history yet. It is fetched in the background; refresh in a moment to see the chart.</p>
      )}

      {/* Trade history */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Trade history</h2>
          {canWrite && (
            <Link
              href={`/wealth/portfolios/${portfolioId}/holdings/${holdingId}/trades/new`}
              className={buttonClass("secondary")}
            >
              <Plus size={16} />
              Add trade
            </Link>
          )}
        </div>

        {tradesDesc.length === 0 ? (
          <p className={emptyStateClass()}>
            No trades yet.
          </p>
        ) : (
          <div className="space-y-3">
            {tradesDesc.map((trade) => {
              // A crypto Trade's stored close came from Yahoo before #404
              // (another asset's price), so it isn't shown.
              const marketClose = crypto ? null : trade.marketPriceOnDate;
              const slippage =
                marketClose != null
                  ? ((trade.pricePerUnit - marketClose) / marketClose) * 100
                  : null;

              return (
                <Card key={trade.id}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <Pill>
                        {TRADE_TYPE_LABELS[trade.type] ?? trade.type}
                      </Pill>
                      <div>
                        <p className="text-sm font-medium">
                          {formatNumber(trade.units, region)} units @ {formatCurrency(trade.pricePerUnit, trade.currency, undefined, region, { showCode: true })}
                        </p>
                        <p className="text-xs text-muted">
                          {formatDate(trade.date, dateFormat)}
                          {trade.fees != null && ` · fees ${formatCurrency(trade.fees, trade.currency, undefined, region, { showCode: true })}`}
                        </p>
                        {marketClose != null && (
                          <p className="mt-0.5 text-xs text-muted">
                            Market close {formatDate(trade.date, dateFormat)}: {formatCurrency(marketClose, trade.currency, undefined, region, { showCode: true })}
                            {slippage != null && (
                              <span className={`ml-1 ${Math.abs(slippage) < 0.5 ? "text-muted" : slippage > 0 ? "text-danger" : "text-success"}`}>
                                ({slippage > 0 ? "+" : ""}{slippage.toFixed(2)}% vs close)
                              </span>
                            )}
                          </p>
                        )}
                        {trade.notes && <p className="mt-1 text-xs text-foreground">{trade.notes}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {canWrite && (
                        <>
                          <Link
                            href={`/wealth/portfolios/${portfolioId}/holdings/${holdingId}/trades/${trade.id}/edit`}
                            className={buttonClass("secondary", { icon: true })}
                            title="Edit trade"
                          >
                            <Pencil size={16} />
                          </Link>
                          <ConfirmForm
                            action={deleteTrade.bind(null, holdingId, trade.id)}
                            undo={{ action: restoreTrade.bind(null, trade.id) }}
                            offline={{
                              entity: "trade",
                              entityId: trade.id,
                              parentId: holdingId,
                              label: `Delete trade: ${holding.ticker} ${formatDate(trade.date, dateFormat)}`,
                            }}
                            confirmText="Delete this trade? Its documents are kept, and you can restore it within 30 days from Settings → Recently deleted."
                            ariaLabel={`Delete trade from ${formatDate(trade.date, dateFormat)}`}
                            className={buttonClass("secondary", { icon: true, destructive: true })}
                          >
                            <Trash2 size={16} />
                          </ConfirmForm>
                        </>
                      )}
                    </div>
                  </div>

                  {(canWrite || trade.documents.length > 0) && (
                    <div className="mt-3 border-t border-border pt-3">
                      {trade.documents.length > 0 && (
                        <DocumentList
                          kind="TRADE"
                          ownerId={trade.id}
                          documents={trade.documents}
                          trashedLinks={trashedLinks.get(trade.id)}
                        />
                      )}
                      <DocumentUploadForm action={addDocumentAction.bind(null, "TRADE", trade.id)} />
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </PageShell>
  );
}
