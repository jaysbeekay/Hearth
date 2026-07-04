import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { monthlyEquivalent, formatCurrency, sumByYear, financialYearLabel } from "@/lib/utils";
import { buildMonthlyTimeline } from "@/lib/spend";

export const metadata: Metadata = { title: "Spend" };

export default async function SpendPage() {
  const session = await auth();
  const enabledModules = await getEnabledModuleKeys();

  const [contracts, homeItems, vehicleItems] = await Promise.all([
    prisma.contract.findMany({
      where: { createdById: session!.user.id, status: "ACTIVE" },
      select: {
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

  const timeline = buildMonthlyTimeline(contracts, 12);
  const maxTotal = Math.max(...timeline.map((b) => b.total), 1);

  return (
    <div className="max-w-3xl space-y-8">
      <h1 className="text-2xl font-semibold">Spend</h1>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-muted">Monthly recurring</p>
          <p className="mt-1 text-2xl font-semibold">{formatCurrency(monthlyTotal, "AUD")}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-muted">Annual projection</p>
          <p className="mt-1 text-2xl font-semibold">{formatCurrency(annualTotal, "AUD")}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-muted">Tax-deductible / mo</p>
          <p className="mt-1 text-2xl font-semibold">{formatCurrency(taxDeductibleMonthly, "AUD")}</p>
        </div>
      </div>

      {/* 12-month timeline chart */}
      <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <h2 className="mb-4 font-medium">Recurring spend — last 12 months</h2>
        <div className="space-y-2">
          {timeline.map((bucket) => (
            <div key={bucket.month} className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-right text-xs text-muted">{bucket.month}</span>
              <div className="flex-1 rounded-full bg-muted/10 h-5 overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent/70 transition-all"
                  style={{ width: `${(bucket.total / maxTotal) * 100}%` }}
                />
              </div>
              <span className="w-20 shrink-0 text-xs text-muted tabular-nums">
                {formatCurrency(bucket.total, "AUD")}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Actuals by FY */}
      {homeActuals.length > 0 && (
        <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
          <h2 className="mb-3 font-medium">Home spend by financial year</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="pb-2">Year</th>
                <th className="pb-2 text-right">Spend</th>
                <th className="pb-2 text-right">Tax deductible</th>
              </tr>
            </thead>
            <tbody>
              {homeActuals.map((row) => {
                const deductible = homeDeductibleActuals.find(
                  (d) => d.label === row.label && d.currency === row.currency,
                );
                return (
                  <tr key={`${row.label}|${row.currency}`} className="border-b border-border/50">
                    <td className="py-2">{row.label}</td>
                    <td className="py-2 text-right tabular-nums">
                      {formatCurrency(row.amount, row.currency)}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {deductible ? formatCurrency(deductible.amount, deductible.currency) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {vehicleActuals.length > 0 && (
        <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
          <h2 className="mb-3 font-medium">Vehicle spend by financial year</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="pb-2">Year</th>
                <th className="pb-2 text-right">Spend</th>
              </tr>
            </thead>
            <tbody>
              {vehicleActuals.map((row) => (
                <tr key={`${row.label}|${row.currency}`} className="border-b border-border/50">
                  <td className="py-2">{row.label}</td>
                  <td className="py-2 text-right tabular-nums">
                    {formatCurrency(row.amount, row.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
