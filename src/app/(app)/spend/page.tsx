import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
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

export const metadata: Metadata = { title: "Spend" };

export default async function SpendPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view: rawView } = await searchParams;
  const view = rawView === "yearly" ? "yearly" : "monthly";

  const session = await auth();
  const [enabledModules, { preferredCurrency }] = await Promise.all([
    getEnabledModuleKeys(),
    getUserPreferences(),
  ]);

  const [contracts, homeItems, vehicleItems] = await Promise.all([
    prisma.contract.findMany({
      where: { createdById: session!.user.id, status: "ACTIVE" },
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
          where: { property: { createdById: session!.user.id } },
          select: { cost: true, date: true, currency: true, isTaxDeductible: true },
        })
      : [],
    enabledModules.has("VEHICLES")
      ? prisma.vehicleItem.findMany({
          where: { vehicle: { createdById: session!.user.id } },
          select: { cost: true, date: true, currency: true },
        })
      : [],
  ]);

  const monthlyTotal = contracts.reduce(
    (sum, c) => sum + monthlyEquivalent(c.cost, c.billingFrequency ?? null),
    0,
  );
  const annualTotal = monthlyTotal * 12;

  const taxDeductibleMonthly = contracts
    .filter((c) => c.isTaxDeductible)
    .reduce((sum, c) => sum + monthlyEquivalent(c.cost, c.billingFrequency ?? null), 0);

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

  const monthlyTimeline = buildMonthlyTimeline(contracts, 12);
  const yearlyTimeline = buildYearlyTimeline(contracts, 5);
  const categoryBreakdown = buildCategoryBreakdown(contracts);
  const categoryTotal = categoryBreakdown.reduce((sum, b) => sum + b.monthlyTotal, 0);

  const timeline = view === "yearly" ? yearlyTimeline : monthlyTimeline;
  const maxTotal = Math.max(...timeline.map((b) => b.total), 1);

  return (
    <div className="max-w-3xl space-y-8">
      <h1 className="text-2xl font-semibold">Spend</h1>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-muted">Monthly recurring</p>
          <p className="mt-1 text-2xl font-semibold">
            {formatCurrency(monthlyTotal, preferredCurrency)}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-muted">Annual projection</p>
          <p className="mt-1 text-2xl font-semibold">
            {formatCurrency(annualTotal, preferredCurrency)}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-muted">Tax-deductible / mo</p>
          <p className="mt-1 text-2xl font-semibold">
            {formatCurrency(taxDeductibleMonthly, preferredCurrency)}
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
                    {formatCurrency(bucket.total, preferredCurrency)}
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
                    {formatCurrency(bucket.total, preferredCurrency)}
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
                    {formatCurrency(bucket.monthlyTotal, preferredCurrency)} ({pct.toFixed(0)}%)
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
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="pb-2">Year</th>
                {homeActuals.length > 0 && (
                  <>
                    <th className="pb-2 text-right">Home</th>
                    <th className="pb-2 text-right">Home tax deductible</th>
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
                        {row.home ? formatCurrency(row.home.amount, row.currency) : "—"}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {row.homeDeductible
                          ? formatCurrency(row.homeDeductible.amount, row.currency)
                          : "—"}
                      </td>
                    </>
                  )}
                  {vehicleActuals.length > 0 && (
                    <td className="py-2 text-right tabular-nums">
                      {row.vehicle ? formatCurrency(row.vehicle.amount, row.currency) : "—"}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
