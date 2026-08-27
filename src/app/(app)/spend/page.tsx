import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import {
  monthlyEquivalent,
  formatCurrency,
  sumByYear,
  financialYearLabel,
  CATEGORY_LABELS,
} from "@/lib/utils";
import { buildMonthlyTimeline, buildYearlyTimeline, buildCategoryBreakdown } from "@/lib/spend";
import { getUserPreferences } from "@/lib/userPreferences";
import { refreshFxRates, getFxRateMap, convertAmount } from "@/lib/fx";

export const metadata: Metadata = { title: "Spend" };

export default async function SpendPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view: rawView } = await searchParams;
  const view = rawView === "yearly" ? "yearly" : "monthly";

  const [enabledModules, { preferredCurrency, region }] = await Promise.all([
    getEnabledModuleKeys(),
    getUserPreferences(),
  ]);

  const [contracts, homeItems, vehicleItems] = await Promise.all([
    prisma.contract.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      select: {
        category: true,
        cost: true,
        billingFrequency: true,
        startDate: true,
        endDate: true,
        currency: true,
        isTaxDeductible: true,
      },
    }),
    enabledModules.has("HOME")
      ? prisma.homeItem.findMany({
          where: { property: { deletedAt: null } },
          select: { cost: true, date: true, currency: true, isTaxDeductible: true },
        })
      : [],
    enabledModules.has("VEHICLES")
      ? prisma.vehicleItem.findMany({
          where: { vehicle: { deletedAt: null } },
          select: { cost: true, date: true, currency: true },
        })
      : [],
  ]);

  const contractCurrencies = [...new Set(contracts.map((c) => c.currency))];
  const fxPairs = contractCurrencies.map((from) => ({ from, to: preferredCurrency }));
  await refreshFxRates(fxPairs);
  const rateMap = await getFxRateMap(fxPairs);

  const convertedContracts = contracts.map((c) => ({
    ...c,
    convertedCost:
      c.cost != null ? convertAmount(c.cost, c.currency, preferredCurrency, rateMap) : null,
  }));
  const hasUnconverted = convertedContracts.some((c) => c.cost != null && c.convertedCost == null);

  const monthlyTotal = convertedContracts.reduce(
    (sum, c) =>
      c.convertedCost == null ? sum : sum + monthlyEquivalent(c.convertedCost, c.billingFrequency ?? null),
    0,
  );
  const annualTotal = monthlyTotal * 12;

  const taxDeductibleMonthly = convertedContracts
    .filter((c) => c.isTaxDeductible)
    .reduce(
      (sum, c) =>
        c.convertedCost == null ? sum : sum + monthlyEquivalent(c.convertedCost, c.billingFrequency ?? null),
      0,
    );

  const homeActuals = sumByYear(
    homeItems.map((i) => ({ cost: i.cost, date: i.date, currency: i.currency })),
    financialYearLabel,
  );
  const vehicleActuals = sumByYear(
    vehicleItems.map((i) => ({ cost: i.cost, date: i.date, currency: i.currency })),
    financialYearLabel,
  );
  const homeDeductibleActuals = sumByYear(
    homeItems
      .filter((i) => i.isTaxDeductible)
      .map((i) => ({ cost: i.cost, date: i.date, currency: i.currency })),
    financialYearLabel,
  );

  // Merge home + vehicle actuals into one table, keyed by year label + currency.
  const actualYearKeys = new Set([
    ...homeActuals.map((r) => `${r.label}|${r.currency}`),
    ...vehicleActuals.map((r) => `${r.label}|${r.currency}`),
  ]);
  const actualsByYear = [...actualYearKeys]
    .map((key) => {
      const [label, currency] = key.split("|");
      const home = homeActuals.find((r) => r.label === label && r.currency === currency);
      const homeDeductible = homeDeductibleActuals.find(
        (r) => r.label === label && r.currency === currency,
      );
      const vehicle = vehicleActuals.find((r) => r.label === label && r.currency === currency);
      return { label, currency, home, homeDeductible, vehicle };
    })
    .sort((a, b) => b.label.localeCompare(a.label));

  const monthlyTimeline = buildMonthlyTimeline(contracts, 12, preferredCurrency, rateMap);
  const yearlyTimeline = buildYearlyTimeline(contracts, 5, preferredCurrency, rateMap);
  const categoryBreakdown = buildCategoryBreakdown(contracts, preferredCurrency, rateMap);
  const categoryTotal = categoryBreakdown.reduce((sum, b) => sum + b.monthlyTotal, 0);

  const timeline = view === "yearly" ? yearlyTimeline : monthlyTimeline;
  const maxTotal = Math.max(...timeline.map((b) => b.total), 1);

  return (
    <div className="max-w-3xl space-y-8">
      <h1 className="text-2xl font-semibold">Spend</h1>

      {hasUnconverted && (
        <p className="text-xs text-warning">
          Some contracts are billed in a currency that couldn&apos;t be converted right now — totals
          below may be incomplete until exchange rates are available.
        </p>
      )}

      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-muted">Monthly recurring</p>
          <p className="mt-1 text-2xl font-semibold">
            {formatCurrency(monthlyTotal, preferredCurrency, undefined, region, { showCode: true })}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-muted">Annual projection</p>
          <p className="mt-1 text-2xl font-semibold">
            {formatCurrency(annualTotal, preferredCurrency, undefined, region, { showCode: true })}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-muted">Tax-deductible / mo</p>
          <p className="mt-1 text-2xl font-semibold">
            {formatCurrency(taxDeductibleMonthly, preferredCurrency, undefined, region, { showCode: true })}
          </p>
        </div>
      </div>

      {/* Timeline chart */}
      <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-medium">
            Recurring spend — {view === "yearly" ? "last 5 years" : "last 12 months"}
          </h2>
          <div className="flex rounded-lg border border-border p-0.5 text-xs">
            <Link
              href="/spend?view=monthly"
              className={`rounded-md px-2.5 py-1 font-medium ${
                view === "monthly" ? "bg-accent/10 text-accent" : "text-muted hover:text-foreground"
              }`}
            >
              Monthly
            </Link>
            <Link
              href="/spend?view=yearly"
              className={`rounded-md px-2.5 py-1 font-medium ${
                view === "yearly" ? "bg-accent/10 text-accent" : "text-muted hover:text-foreground"
              }`}
            >
              Yearly
            </Link>
          </div>
        </div>
        <div className="space-y-2">
          {view === "yearly"
            ? yearlyTimeline.map((bucket) => (
                <div key={bucket.year} className="flex items-center gap-3">
                  <span className="w-16 shrink-0 text-right text-xs text-muted">{bucket.year}</span>
                  <div className="flex-1 rounded-full bg-muted/10 h-5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-accent/70 transition-all"
                      style={{ width: `${(bucket.total / maxTotal) * 100}%` }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-xs text-muted tabular-nums">
                    {formatCurrency(bucket.total, preferredCurrency, undefined, region, { showCode: true })}
                  </span>
                </div>
              ))
            : monthlyTimeline.map((bucket) => (
                <div key={bucket.month} className="flex items-center gap-3">
                  <span className="w-16 shrink-0 text-right text-xs text-muted">{bucket.month}</span>
                  <div className="flex-1 rounded-full bg-muted/10 h-5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-accent/70 transition-all"
                      style={{ width: `${(bucket.total / maxTotal) * 100}%` }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-xs text-muted tabular-nums">
                    {formatCurrency(bucket.total, preferredCurrency, undefined, region, { showCode: true })}
                  </span>
                </div>
              ))}
        </div>
      </section>

      {/* Category breakdown */}
      {categoryBreakdown.length > 0 && (
        <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
          <h2 className="mb-4 font-medium">Recurring spend by category</h2>
          <div className="space-y-2">
            {categoryBreakdown.map((bucket) => {
              const pct = categoryTotal > 0 ? (bucket.monthlyTotal / categoryTotal) * 100 : 0;
              return (
                <div key={bucket.category} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 truncate text-xs text-muted">
                    {CATEGORY_LABELS[bucket.category] ?? bucket.category}
                  </span>
                  <div className="flex-1 rounded-full bg-muted/10 h-5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-accent/70 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-28 shrink-0 text-right text-xs text-muted tabular-nums">
                    {formatCurrency(bucket.monthlyTotal, preferredCurrency, undefined, region, { showCode: true })} ({pct.toFixed(0)}%)
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Actuals by year */}
      {actualsByYear.length > 0 && (
        <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
          <h2 className="mb-3 font-medium">Actuals by financial year</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="pb-2">Year</th>
                  {homeActuals.length > 0 && (
                    <>
                      <th className="pb-2 text-right">Property</th>
                      <th className="pb-2 text-right">Property tax deductible</th>
                    </>
                  )}
                  {vehicleActuals.length > 0 && <th className="pb-2 text-right">Vehicle</th>}
                </tr>
              </thead>
              <tbody>
                {actualsByYear.map((row) => (
                  <tr key={`${row.label}|${row.currency}`} className="border-b border-border/50">
                    <td className="py-2">{row.label}</td>
                    {homeActuals.length > 0 && (
                      <>
                        <td className="py-2 text-right tabular-nums">
                          {row.home ? formatCurrency(row.home.amount, row.currency, undefined, region, { showCode: true }) : "—"}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {row.homeDeductible
                            ? formatCurrency(row.homeDeductible.amount, row.currency, undefined, region, { showCode: true })
                            : "—"}
                        </td>
                      </>
                    )}
                    {vehicleActuals.length > 0 && (
                      <td className="py-2 text-right tabular-nums">
                        {row.vehicle ? formatCurrency(row.vehicle.amount, row.currency, undefined, region, { showCode: true }) : "—"}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
