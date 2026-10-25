import type { Metadata } from "next";
import Link from "next/link";
import { Plus, ChevronDown, AlertTriangle } from "lucide-react";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { getNetWorth } from "@/lib/wealth";
import { refreshPricesForTickers } from "@/lib/prices";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { getUserPreferences } from "@/lib/userPreferences";
import { HoldingCard } from "@/components/HoldingCard";
import type { ModuleKey } from "@/lib/modules/registry";
import { linkButtonClass, toolbarButtonClass, exportMenuItemClass } from "@/lib/buttonStyles";

export const metadata: Metadata = { title: "Wealth" };

export default async function WealthPage() {
  await requireModuleEnabled("WEALTH");
  const enabledModules = await getEnabledModuleKeys();
  const { region } = await getUserPreferences();

  // Warm up prices in background before rendering
  const holdings = await prisma.holding.findMany({
    distinct: ["ticker"],
    select: { ticker: true, exchange: true },
  });
  if (holdings.length) {
    await refreshPricesForTickers(holdings).catch(() => {});
  }

  const data = await getNetWorth(enabledModules as Set<ModuleKey>);
  const hasPortfolios = data.portfolios.length > 0;
  const allHoldings = data.portfolios.flatMap((p) => p.holdings);
  const topHoldings = [...allHoldings]
    .sort((a, b) => (b.currentValue ?? 0) - (a.currentValue ?? 0))
    .slice(0, 6);

  // Plain allocation list (#408 replaced the donut chart).
  const segments = [
    { label: "Shares / ETFs / Crypto", value: data.sharesValue },
    { label: "Property", value: data.propertyValue },
    { label: "Inventory", value: data.inventoryValue },
  ].filter((s) => s.value > 0);
  const total = segments.reduce((s, seg) => s + seg.value, 0);

  return (
    <div className="max-w-4xl space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Wealth</h1>
        <div className="flex items-center gap-2">
          <details className="relative">
            <summary className={toolbarButtonClass}>
              Export <ChevronDown size={14} />
            </summary>
            <div className="absolute right-0 z-10 mt-1 w-28 overflow-hidden rounded-lg border border-border bg-surface shadow-md">
              <a href="/api/export/wealth?format=csv" download className={exportMenuItemClass}>CSV</a>
              <a href="/api/export/wealth?format=pdf" download className={exportMenuItemClass}>PDF</a>
            </div>
          </details>
          {hasPortfolios && (
            <Link href="/wealth/portfolios" className={toolbarButtonClass}>
              Manage portfolios
            </Link>
          )}
          {!hasPortfolios && (
            <Link href="/wealth/portfolios/new" className={linkButtonClass("primary")}>
              <Plus size={16} />
              Add portfolio
            </Link>
          )}
        </div>
      </div>

      {data.propertyStale && enabledModules.has("HOME") && (
        <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>One or more properties don&apos;t have a valuation in the last 12 months. <Link href="/home" className="underline">Update property valuations</Link> for a more accurate net worth.</span>
        </div>
      )}

      {/* Net worth tiles */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="col-span-2 rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-muted">Total net worth</p>
          <p className="mt-1 text-3xl font-bold">{formatCurrency(data.totalNetWorth, "AUD", undefined, region, { showCode: true })}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-muted">Shares / ETFs</p>
          <p className="mt-1 text-xl font-semibold">{formatCurrency(data.sharesValue, "AUD", undefined, region, { showCode: true })}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-muted">Property</p>
          <p className="mt-1 text-xl font-semibold">{formatCurrency(data.propertyValue, "AUD", undefined, region, { showCode: true })}</p>
        </div>
      </div>

      {/* Allocation */}
      {total > 0 && (
        <section className="space-y-3">
          <h2 className="font-medium">Allocation</h2>
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {segments.map((seg) => (
              <li key={seg.label} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                <span>{seg.label}</span>
                <span className="flex items-center gap-3">
                  <span className="text-muted">{((seg.value / total) * 100).toFixed(0)}%</span>
                  <span className="font-medium">{formatCurrency(seg.value, "AUD", undefined, region, { showCode: true })}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Holdings */}
      {topHoldings.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Holdings</h2>
            {data.portfolios.length === 1 && (
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
          {hasPortfolios && data.portfolios[0] && (
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
