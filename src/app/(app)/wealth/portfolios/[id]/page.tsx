import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, Upload, Pencil } from "lucide-react";
import { auth } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { getNetWorth } from "@/lib/wealth";
import { refreshPricesForTickers } from "@/lib/prices";
import { HoldingCard } from "@/components/HoldingCard";
import type { ModuleKey } from "@/lib/modules/registry";

export const metadata: Metadata = { title: "Portfolio" };

export default async function PortfolioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleEnabled("WEALTH");
  const session = await auth();
  const { id } = await params;

  const portfolio = await prisma.portfolio.findUnique({
    where: { id },
    include: { holdings: { include: { _count: { select: { trades: true } } } } },
  });
  if (!portfolio || portfolio.createdById !== session!.user.id) notFound();

  const holdingTickers = portfolio.holdings.map((h) => ({ ticker: h.ticker, exchange: h.exchange }));
  if (holdingTickers.length) {
    await refreshPricesForTickers(holdingTickers).catch(() => {});
  }

  const enabledModules = await getEnabledModuleKeys();
  const netWorth = await getNetWorth(session!.user.id, enabledModules as Set<ModuleKey>);
  const portfolioValue = netWorth.portfolios.find((p) => p.portfolioId === id);

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/wealth/portfolios" className="text-sm text-foreground/60 hover:text-foreground">← Portfolios</Link>
        <div className="mt-1 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{portfolio.name}</h1>
            {portfolio.description && <p className="text-sm text-foreground/60">{portfolio.description}</p>}
          </div>
          <Link
            href={`/wealth/portfolios/${id}/edit`}
            className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
          >
            <Pencil size={16} />
            Edit
          </Link>
        </div>
      </div>

      {portfolioValue && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="text-xs text-foreground/50">Market value</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{formatCurrency(portfolioValue.totalValue, portfolio.currency)}</p>
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="text-xs text-foreground/50">Cost basis</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{formatCurrency(portfolioValue.totalCost, portfolio.currency)}</p>
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="text-xs text-foreground/50">Total gain / loss</p>
            <p className={`mt-1 text-xl font-semibold tabular-nums ${(portfolioValue.totalValue - portfolioValue.totalCost) >= 0 ? "text-success" : "text-danger"}`}>
              {formatCurrency(portfolioValue.totalValue - portfolioValue.totalCost, portfolio.currency)}
            </p>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Holdings</h2>
          <div className="flex items-center gap-2">
            <Link
              href={`/wealth/portfolios/${id}/import`}
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
            >
              <Upload size={16} />
              Import CSV
            </Link>
            <Link
              href={`/wealth/portfolios/${id}/holdings/new`}
              className="flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
            >
              <Plus size={16} />
              Add holding
            </Link>
          </div>
        </div>

        {!portfolioValue?.holdings.length ? (
          <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-foreground/60">
            No holdings yet. Add a holding manually or import a CSV of your trade history.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {portfolioValue.holdings.map((h) => (
              <HoldingCard key={h.holdingId} holding={h} portfolioId={id} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
