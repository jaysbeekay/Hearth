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
import {
  buildMonthlyTimeline,
  buildYearlyTimeline,
  buildCategoryBreakdown,
  monthlySpend,
  nextTwelveMonthsSpend,
  timelineIsFlat,
} from "@/lib/spend";
import { getUserPreferences } from "@/lib/userPreferences";
import { refreshFxRates, getFxRateMap, convertAmount } from "@/lib/fx";
import { Card } from "@/components/ui/Card";
import { Banner } from "@/components/ui/Banner";
import { ChevronDown } from "lucide-react";
import { cardClass, chipClass } from "@/lib/ui";
import { PageShell } from "@/components/ui/PageShell";

export const metadata: Metadata = { title: "Spending" };

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
        renewalType: true,
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
  // The same figure as the dashboard and spend_summary (#394).
  const { total: monthlyTotal, unconvertedCurrencies } = monthlySpend(contracts, preferredCurrency, rateMap);
  const hasUnconverted = unconvertedCurrencies.length > 0;
  const nextTwelveMonths = nextTwelveMonthsSpend(contracts, preferredCurrency, rateMap);
  // #367 — the same exclusion the dashboard flags under Missing key details:
  // a cost with no billing frequency adds nothing to the monthly figure.
  const noFrequencyCount = contracts.filter((c) => c.cost != null && c.billingFrequency == null).length;

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
  const flat = timelineIsFlat(timeline);
  const showTax = taxDeductibleMonthly > 0;

  return (
    <PageShell width="list">
      <h1 className="text-2xl font-medium">Spending</h1>

      {hasUnconverted && (
        <p className="text-xs text-warning">
          Some contracts are billed in a currency that couldn&apos;t be converted right now — totals
          below may be incomplete until exchange rates are available.
        </p>
      )}

      {/* Summary tiles. #403 — formatCurrency joins the code with a no-break
          space, so the whole amount is one unbreakable word; wrap-anywhere
          (unlike break-words) reliably breaks it inside the narrow tile. */}
      {noFrequencyCount > 0 && (
        <Banner tone="warning" className="text-sm">
          {noFrequencyCount === 1
            ? "1 contract has a cost but no billing frequency, so it isn't counted here or on the dashboard. "
            : `${noFrequencyCount} contracts have a cost but no billing frequency, so they aren't counted here or on the dashboard. `}
          <Link href="/contracts?missing=details" className="font-medium underline">
            Set the billing frequency
          </Link>
        </Banner>
      )}

      <div className={`grid grid-cols-2 gap-4 ${showTax ? "sm:grid-cols-3" : ""}`}>
        <Card className="min-w-0">
          <p className="text-xs text-muted">Monthly recurring</p>
          <p className="mt-1 wrap-anywhere text-xl font-medium sm:text-2xl">
            {formatCurrency(monthlyTotal, preferredCurrency, undefined, region, { showCode: true })}
          </p>
        </Card>
        <Card className="min-w-0">
          <p className="text-xs text-muted">Next 12 months</p>
          <p className="mt-1 wrap-anywhere text-xl font-medium sm:text-2xl">
            {formatCurrency(nextTwelveMonths, preferredCurrency, undefined, region, { showCode: true })}
          </p>
          <p className="mt-1 text-xs text-muted">Contracts that don&apos;t auto-renew count up to their end date.</p>
        </Card>
        {/* #367 — no tile for a total of zero. */}
        {showTax && (
          <Card className="min-w-0">
            <p className="text-xs text-muted">Tax-deductible / mo</p>
            <p className="mt-1 wrap-anywhere text-xl font-medium sm:text-2xl">
              {formatCurrency(taxDeductibleMonthly, preferredCurrency, undefined, region, { showCode: true })}
            </p>
          </Card>
        )}
      </div>

      {/* Category breakdown */}
      {categoryBreakdown.length > 0 && (
        <Card as="section">
          <h2 className="mb-4 font-medium">Recurring cost by category</h2>
          <div className="space-y-2">
            {categoryBreakdown.map((bucket) => {
              const pct = categoryTotal > 0 ? (bucket.monthlyTotal / categoryTotal) * 100 : 0;
              return (
                <div key={bucket.category} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 truncate text-xs text-muted">
                    {CATEGORY_LABELS[bucket.category] ?? bucket.category}
                  </span>
                  <div className="flex-1 h-5 overflow-hidden rounded-lg bg-muted/10">
                    <div
                      className="h-full rounded-lg bg-accent/70"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-28 shrink-0 text-right text-xs text-muted">
                    {formatCurrency(bucket.monthlyTotal, preferredCurrency, undefined, region, { showCode: true })} ({pct.toFixed(0)}%)
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Timeline — #367: folded, since for most households it barely
          changes; the breakdown above is the useful view. Opens when the
          Monthly/Yearly toggle was used. */}
      <details open={rawView ? true : undefined} className={cardClass({ padding: "none" }, "group")}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
          <h2 className="font-medium">
            Recurring cost over time
          </h2>
          <ChevronDown size={16} aria-hidden className="shrink-0 text-muted transition-transform group-open:rotate-180" />
        </summary>
        <div className="px-4 pb-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-sm text-muted">{view === "yearly" ? "Last 5 years" : "Last 12 months"}</p>
            <div className="flex gap-2">
              <Link
                href="/spend?view=monthly"
                className={chipClass(view === "monthly")}
              >
                Monthly
              </Link>
              <Link
                href="/spend?view=yearly"
                className={chipClass(view === "yearly")}
              >
                Yearly
              </Link>
            </div>
          </div>
          {flat ? (
            <p className="text-sm text-muted">
              No change {view === "yearly" ? "in the last 5 years" : "in the last 12 months"}: about{" "}
              {formatCurrency(timeline[0]?.total ?? 0, preferredCurrency, undefined, region, { showCode: true })}{" "}
              {view === "yearly" ? "a year" : "a month"}. This chart only shows when contracts start or end.
            </p>
          ) : (
          <div className="space-y-2">
            {view === "yearly"
              ? yearlyTimeline.map((bucket) => (
                  <div key={bucket.year} className="flex items-center gap-3">
                    <span className="w-16 shrink-0 text-right text-xs text-muted">{bucket.year}</span>
                    <div className="flex-1 h-5 overflow-hidden rounded-lg bg-muted/10">
                      <div
                        className="h-full rounded-lg bg-accent/70"
                        style={{ width: `${(bucket.total / maxTotal) * 100}%` }}
                      />
                    </div>
                    <span className="w-20 shrink-0 text-xs text-muted">
                      {formatCurrency(bucket.total, preferredCurrency, undefined, region, { showCode: true })}
                    </span>
                  </div>
                ))
              : monthlyTimeline.map((bucket) => (
                  <div key={bucket.month} className="flex items-center gap-3">
                    <span className="w-16 shrink-0 text-right text-xs text-muted">{bucket.month}</span>
                    <div className="flex-1 h-5 overflow-hidden rounded-lg bg-muted/10">
                      <div
                        className="h-full rounded-lg bg-accent/70"
                        style={{ width: `${(bucket.total / maxTotal) * 100}%` }}
                      />
                    </div>
                    <span className="w-20 shrink-0 text-xs text-muted">
                      {formatCurrency(bucket.total, preferredCurrency, undefined, region, { showCode: true })}
                    </span>
                  </div>
                ))}
          </div>
          )}
        </div>
      </details>

      {/* Actuals by year */}
      {actualsByYear.length > 0 && (
        <Card as="section">
          <h2 className="mb-3 font-medium">Actuals by financial year</h2>
          <div className="overflow-x-auto">
            {/* #403 — pl-4 + nowrap keep the amount columns from running into
                each other at phone widths; overflow-x-auto scrolls the rest. */}
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="pb-2">Year</th>
                  {homeActuals.length > 0 && (
                    <>
                      <th className="pb-2 pl-4 text-right">Property</th>
                      <th className="pb-2 pl-4 text-right">Property tax deductible</th>
                    </>
                  )}
                  {vehicleActuals.length > 0 && <th className="pb-2 pl-4 text-right">Vehicle</th>}
                </tr>
              </thead>
              <tbody>
                {actualsByYear.map((row) => (
                  <tr key={`${row.label}|${row.currency}`} className="border-b border-border/50">
                    <td className="py-2">{row.label}</td>
                    {homeActuals.length > 0 && (
                      <>
                        <td className="py-2 pl-4 text-right whitespace-nowrap">
                          {row.home ? formatCurrency(row.home.amount, row.currency, undefined, region, { showCode: true }) : "—"}
                        </td>
                        <td className="py-2 pl-4 text-right whitespace-nowrap">
                          {row.homeDeductible
                            ? formatCurrency(row.homeDeductible.amount, row.currency, undefined, region, { showCode: true })
                            : "—"}
                        </td>
                      </>
                    )}
                    {vehicleActuals.length > 0 && (
                      <td className="py-2 pl-4 text-right whitespace-nowrap">
                        {row.vehicle ? formatCurrency(row.vehicle.amount, row.currency, undefined, region, { showCode: true }) : "—"}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </PageShell>
  );
}
