import type { Metadata } from "next";
import Link from "next/link";
import { Plus, ChevronDown, AlertTriangle } from "lucide-react";
import { auth } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { getNetWorth } from "@/lib/wealth";
import { refreshPricesForTickers } from "@/lib/prices";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { HoldingCard } from "@/components/HoldingCard";
import type { ModuleKey } from "@/lib/modules/registry";

export const metadata: Metadata = { title: "Wealth" };

export default async function WealthPage() {
  await requireModuleEnabled("WEALTH");
  const session = await auth();
  const enabledModules = await getEnabledModuleKeys();

  // Warm up prices in background before rendering
  const holdings = await prisma.holding.findMany({
    where: { portfolio: { createdById: session!.user.id } },
    distinct: ["ticker"],
    select: { ticker: true, exchange: true },
  });
  if (holdings.length) {
    await refreshPricesForTickers(holdings).catch(() => {});
  }

  const data = await getNetWorth(session!.user.id, enabledModules as Set<ModuleKey>);
  const hasPortfolios = data.portfolios.length > 0;
  const allHoldings = data.portfolios.flatMap((p) => p.holdings);
  const topHoldings = [...allHoldings]
    .sort((a, b) => (b.currentValue ?? 0) - (a.currentValue ?? 0))
    .slice(0, 6);

  // SVG donut data
  const segments = [
    { label: "Shares / ETFs / Crypto", value: data.sharesValue, color: "var(--color-accent, #4CA3D6)" },
    { label: "Property", value: data.propertyValue, color: "#3CB87A" },
    { label: "Inventory", value: data.inventoryValue, color: "#E0A040" },
  ].filter((s) => s.value > 0);

  const total = segments.reduce((s, seg) => s + seg.value, 0);
  let cumulative = 0;
  const slices = segments.map((seg) => {
    const pct = total > 0 ? seg.value / total : 0;
    const startAngle = cumulative * 360;
    const endAngle = (cumulative + pct) * 360;
    cumulative += pct;

    const r = 60;
    const cx = 80;
    const cy = 80;
    const toRad = (deg: number) => (deg - 90) * (Math.PI / 180);
    const x1 = cx + r * Math.cos(toRad(startAngle));
    const y1 = cy + r * Math.sin(toRad(startAngle));
    const x2 = cx + r * Math.cos(toRad(endAngle));
    const y2 = cy + r * Math.sin(toRad(endAngle));
    const large = pct > 0.5 ? 1 : 0;

    return { ...seg, pct, d: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z` };
  });

  return (
    <div className="max-w-4xl space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Wealth</h1>
        <div className="flex items-center gap-2">
          <details className="relative">
            <summary className="flex cursor-pointer list-none items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5">
              Export <ChevronDown size={14} />
            </summary>
            <div className="absolute right-0 z-10 mt-1 w-28 overflow-hidden rounded-lg border border-border bg-surface shadow-md">
              <a href="/api/export/wealth?format=csv" download className="block px-4 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5">CSV</a>
              <a href="/api/export/wealth?format=pdf" download className="block px-4 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5">PDF</a>
            </div>
          </details>
          {hasPortfolios && (
            <Link
              href="/wealth/portfolios"
              className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
            >
              Manage portfolios
            </Link>
          )}
          {!hasPortfolios && (
            <Link
              href="/wealth/portfolios/new"
              className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
            >
              <Plus size={16} />
              Add portfolio
            </Link>
          )}
        </div>
      </div>

      {data.propertyStale && enabledModules.has("HOME") && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>One or more properties don&apos;t have a valuation in the last 12 months. <Link href="/home" className="underline">Update property valuations</Link> for a more accurate net worth.</span>
        </div>
      )}

      {/* Net worth tiles */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="col-span-2 rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-foreground/50">Total net worth</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{formatCurrency(data.totalNetWorth, "AUD")}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-foreground/50">Shares / ETFs</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{formatCurrency(data.sharesValue, "AUD")}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-foreground/50">Property</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{formatCurrency(data.propertyValue, "AUD")}</p>
        </div>
      </div>

      {/* Allocation chart + breakdown */}
      {total > 0 && (
        <div className="flex flex-col gap-6 rounded-xl border border-border bg-surface p-4 md:flex-row md:p-6">
          <div className="flex items-center justify-center">
            <svg width="160" height="160" viewBox="0 0 160 160" aria-hidden="true">
              {slices.length === 1 ? (
                <circle cx="80" cy="80" r="60" fill={slices[0].color} />
              ) : (
                slices.map((s, i) => <path key={i} d={s.d} fill={s.color} />)
              )}
              <circle cx="80" cy="80" r="38" fill="var(--color-surface, #1B2435)" />
            </svg>
          </div>
          <div className="flex-1 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground/50 mb-3">Asset breakdown</p>
            {segments.map((seg) => (
              <div key={seg.label} className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: seg.color }} />
                  <span className="text-sm">{seg.label}</span>
                </div>
                <div className="flex items-center gap-3 tabular-nums text-sm">
                  <span className="text-foreground/60">{((seg.value / total) * 100).toFixed(0)}%</span>
                  <span className="font-medium">{formatCurrency(seg.value, "AUD")}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
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
              return <HoldingCard key={h.holdingId} holding={h} portfolioId={portfolio.portfolioId} />;
            })}
          </div>
          {allHoldings.length > 6 && (
            <p className="text-center text-sm text-foreground/50">
              Showing top 6 of {allHoldings.length} holdings.{" "}
              <Link href="/wealth/portfolios" className="text-accent hover:underline">View all</Link>
            </p>
          )}
        </section>
      ) : (
        <div className="space-y-4">
          <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-foreground/60">
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
                className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
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
