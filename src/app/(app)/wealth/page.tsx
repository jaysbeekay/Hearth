import type { Metadata } from "next";
import Link from "next/link";
import { Plus, AlertTriangle } from "lucide-react";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { getNetWorth, netWorthExclusionNote } from "@/lib/wealth";
import { refreshPricesForTickers } from "@/lib/prices";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { getUserPreferences } from "@/lib/userPreferences";
import { HoldingCard } from "@/components/HoldingCard";
import { ListPageHeader, type ListPageAction } from "@/components/ListPageHeader";
import type { ModuleKey } from "@/lib/modules/registry";
import { auth } from "@/lib/auth";
import { canWrite as sessionCanWrite } from "@/lib/readOnly";

export const metadata: Metadata = { title: "Wealth" };

export default async function WealthPage() {
  await requireModuleEnabled("WEALTH");
  const canWrite = sessionCanWrite(await auth());
  const enabledModules = await getEnabledModuleKeys();
  const { region } = await getUserPreferences();

  // Refresh prices before rendering. Not distinct by ticker: a crypto and an
  // equity can share one (#404) and are priced separately.
  const holdings = await prisma.holding.findMany({
    select: { ticker: true, exchange: true, assetClass: true },
  });
  if (holdings.length) {
    await refreshPricesForTickers(holdings).catch(() => {});
  }

  const data = await getNetWorth(enabledModules as Set<ModuleKey>);
  const exclusionNote = netWorthExclusionNote(data.excluded);
  const hasPortfolios = data.portfolios.length > 0;
  const allHoldings = data.portfolios.flatMap((p) => p.holdings);
  // Ranked by value in the net-worth currency, not raw mixed currencies.
  const topHoldings = [...allHoldings]
    .sort((a, b) => (b.netWorthValue ?? 0) - (a.netWorthValue ?? 0))
    .slice(0, 6);

  // #404 — one plain list of every part of the total, so the figures shown
  // always add up to it (#408 replaced the donut chart).
  const total = data.totalNetWorth;
  const percentOf = (value: number) => (total > 0 ? `${((value / total) * 100).toFixed(0)}%` : "");

  let headerAction: ListPageAction | undefined;
  if (hasPortfolios) {
    headerAction = { href: "/wealth/portfolios", label: "Manage portfolios", variant: "secondary" };
  } else if (canWrite) {
    headerAction = { href: "/wealth/portfolios/new", label: "Add portfolio" };
  }

  return (
    <div className="max-w-4xl space-y-8">
      <ListPageHeader title="Wealth" exportPath="/api/export/wealth" action={headerAction} />

      {data.propertyStale && enabledModules.has("HOME") && (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/10 px-4 py-3 text-sm text-foreground">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>One or more properties don&apos;t have a valuation in the last 12 months. <Link href="/home" className="underline">Update property valuations</Link> for a more accurate net worth.</span>
        </div>
      )}

      {/* Net worth: the total, then every part of it */}
      <section className="space-y-3" aria-label="Net worth">
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-muted">Total net worth</p>
          <p className="mt-1 text-3xl font-bold" data-testid="net-worth-total" data-value={total}>{formatCurrency(total, data.currency, undefined, region, { showCode: true })}</p>
        </div>
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface" data-testid="net-worth-components">
          {data.components.map((c) => (
            <li key={c.key} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
              <span>{c.label}</span>
              <span className="flex items-center gap-3">
                <span className="text-muted">{percentOf(c.value)}</span>
                <span className="font-medium" data-testid="net-worth-component-value" data-value={c.value}>{formatCurrency(c.value, data.currency, undefined, region, { showCode: true })}</span>
              </span>
            </li>
          ))}
        </ul>
        {exclusionNote && <p className="text-sm text-muted" data-testid="net-worth-exclusions">{exclusionNote}</p>}
      </section>

      {/* Holdings */}
      {topHoldings.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Holdings</h2>
            {canWrite && data.portfolios.length === 1 && (
              <Link
                href={`/wealth/portfolios/${data.portfolios[0].portfolioId}/holdings/new`}
                className="flex items-center gap-1 text-sm text-accent hover:underline"
              >
                <Plus size={14} />
                Add holding
              </Link>
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {topHoldings.map((h) => {
              const portfolio = data.portfolios.find((p) =>
                p.holdings.some((ph) => ph.holdingId === h.holdingId),
              )!;
              return <HoldingCard key={h.holdingId} holding={h} portfolioId={portfolio.portfolioId} region={region} />;
            })}
          </div>
          {allHoldings.length > 6 && (
            <p className="text-center text-sm text-muted">
              Showing top 6 of {allHoldings.length} holdings.{" "}
              <Link href="/wealth/portfolios" className="text-accent hover:underline">View all</Link>
            </p>
          )}
        </section>
      ) : (
        <div className="space-y-4">
          <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted">
            {hasPortfolios
              ? "No holdings yet. Add your first holding or import trades from a CSV."
              : "Create a portfolio to start tracking your shares and investments."}
          </p>
          {canWrite && hasPortfolios && data.portfolios[0] && (
            <div className="flex justify-center gap-3">
              <Link
                href={`/wealth/portfolios/${data.portfolios[0].portfolioId}/holdings/new`}
                className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
              >
                <Plus size={16} />
                Add holding
              </Link>
              <Link
                href={`/wealth/portfolios/${data.portfolios[0].portfolioId}/import`}
                className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-hover"
              >
                Import CSV
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
