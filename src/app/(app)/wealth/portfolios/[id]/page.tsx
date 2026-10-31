import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, Upload, Pencil } from "lucide-react";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { getNetWorth, unpricedHoldingsNote } from "@/lib/wealth";
import { refreshPricesForTickers } from "@/lib/prices";
import { getUserPreferences } from "@/lib/userPreferences";
import { HoldingCard } from "@/components/HoldingCard";
import type { ModuleKey } from "@/lib/modules/registry";
import { COST_METHOD_LABELS } from "@/lib/validation/wealth";
import { auth } from "@/lib/auth";
import { canWrite as sessionCanWrite } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";

export const metadata: Metadata = { title: "Portfolio" };

export default async function PortfolioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleEnabled("WEALTH");
  const { id } = await params;
  const canWrite = sessionCanWrite(await auth());

  const portfolio = await prisma.portfolio.findUnique({
    where: { id },
    include: { holdings: { include: { _count: { select: { trades: { where: { deletedAt: null } } } } } } },
  });
  if (!portfolio) notFound();

  const holdingTickers = portfolio.holdings.map((h) => ({ ticker: h.ticker, exchange: h.exchange, assetClass: h.assetClass }));
  if (holdingTickers.length) {
    await refreshPricesForTickers(holdingTickers).catch(() => {});
  }

  const [enabledModules, { region }] = await Promise.all([
    getEnabledModuleKeys(),
    getUserPreferences(),
  ]);
  const netWorth = await getNetWorth(enabledModules as Set<ModuleKey>);
  const portfolioValue = netWorth.portfolios.find((p) => p.portfolioId === id);
  // Gain/loss compares counted holdings' value with their own cost only, so
  // an unpriced holding's cost doesn't show as a loss (#404).
  const pricedGainLoss = portfolioValue ? portfolioValue.totalValue - portfolioValue.pricedCost : 0;
  // The cost tile shows the same holdings as value and gain/loss, so the
  // three add up; the cost of holdings left out is shown under it.
  const excludedCost = portfolioValue ? portfolioValue.totalCost - portfolioValue.pricedCost : 0;
  const unpricedNote = unpricedHoldingsNote(portfolioValue?.unpricedCount ?? 0);

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <BackLink href="/wealth/portfolios" label="Portfolios" />
        <div className="mt-1 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-medium">{portfolio.name}</h1>
            {portfolio.description && <p className="text-sm text-muted">{portfolio.description}</p>}
          </div>
          {canWrite && (
            <Link
              href={`/wealth/portfolios/${id}/edit`}
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-hover"
            >
              <Pencil size={16} />
              Edit
            </Link>
          )}
        </div>
      </div>

      {portfolioValue && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-surface p-4">
            <p className="text-xs text-muted">Market value</p>
            <p className="mt-1 text-xl font-medium">{formatCurrency(portfolioValue.totalValue, portfolio.currency, undefined, region, { showCode: true })}</p>
          </div>
          <div className="rounded-lg border border-border bg-surface p-4">
            <p className="text-xs text-muted">
              Cost basis <span className="text-muted">({COST_METHOD_LABELS[portfolio.costMethod]})</span>
            </p>
            <p className="mt-1 text-xl font-medium">{formatCurrency(portfolioValue.pricedCost, portfolio.currency, undefined, region, { showCode: true })}</p>
            {excludedCost > 0.005 && (
              <p className="text-xs text-muted" data-testid="excluded-cost">
                Plus {formatCurrency(excludedCost, portfolio.currency, undefined, region, { showCode: true })} not counted
              </p>
            )}
          </div>
          <div className="rounded-lg border border-border bg-surface p-4">
            <p className="text-xs text-muted">Total gain / loss</p>
            <p className={`mt-1 text-xl font-medium ${pricedGainLoss >= 0 ? "text-success" : "text-danger"}`}>
              {formatCurrency(pricedGainLoss, portfolio.currency, undefined, region, { showCode: true })}
            </p>
          </div>
        </div>
      )}
      {unpricedNote && (
        <p className="text-sm text-muted">{unpricedNote}</p>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Holdings</h2>
          <div className="flex items-center gap-2">
            {canWrite && (
              <Link
                href={`/wealth/portfolios/${id}/import`}
                className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-hover"
              >
                <Upload size={16} />
                Import CSV
              </Link>
            )}
            {canWrite && (
              <Link
                href={`/wealth/portfolios/${id}/holdings/new`}
                className="flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
              >
                <Plus size={16} />
                Add holding
              </Link>
            )}
          </div>
        </div>

        {!portfolioValue?.holdings.length ? (
          <p className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted">
            No holdings yet. Add a holding manually or import a CSV of your trade history.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {portfolioValue.holdings.map((h) => (
              <HoldingCard key={h.holdingId} holding={h} portfolioId={id} region={region} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
