import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Upload } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { TripCard } from "@/components/TripCard";
import { StatCard } from "@/components/StatCard";
import { AddEntryPicker } from "@/components/AddEntryPicker";
import { OnboardingChecklist } from "@/components/OnboardingChecklist";
import { daysUntil, monthlyEquivalent, formatCurrency } from "@/lib/utils";
import { getUserPreferences } from "@/lib/userPreferences";
import { refreshFxRates, getFxRateMap, convertAmount } from "@/lib/fx";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { auth } from "@/lib/auth";
import { isSmtpConfigured, isNtfyConfigured } from "@/lib/appSettings";
import { getDocumentStats } from "@/lib/documents/stats";
import {
  buildContractAttentionItems,
  buildWarrantyAttentionItems,
  buildVehicleAttentionItems,
  buildReminderNudgeItem,
  buildExtractionReviewItems,
  buildReminderFailureItems,
  sortAttentionItems,
} from "@/lib/needsAttention";
import { NeedsAttentionQueue } from "@/components/NeedsAttentionQueue";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const [enabledModules, { preferredCurrency, region }, session, smtpConfigured, ntfyConfigured] =
    await Promise.all([
      getEnabledModuleKeys(),
      getUserPreferences(),
      auth(),
      isSmtpConfigured(),
      isNtfyConfigured(),
    ]);

  const [contracts, products, vehicles, trips, memberCount, documentStats, failedReminderLogs] =
    await Promise.all([
      prisma.contract.findMany({
        where: { deletedAt: null },
        orderBy: { endDate: "asc" },
        include: { _count: { select: { documents: true } } },
      }),
      prisma.product.findMany({
        where: { deletedAt: null },
        orderBy: { warrantyEndDate: "asc" },
        include: { _count: { select: { documents: true } } },
      }),
      enabledModules.has("VEHICLES")
        ? prisma.vehicle.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "desc" } })
        : [],
      enabledModules.has("TRAVEL")
        ? prisma.trip.findMany({
            where: { deletedAt: null },
            orderBy: { startDate: "asc" },
            include: { _count: { select: { segments: true } } },
          })
        : [],
      prisma.user.count(),
      getDocumentStats(enabledModules),
      prisma.notificationLog.findMany({
        where: { status: "FAILED" },
        orderBy: { sentAt: "desc" },
        select: { ownerType: true, ownerId: true, error: true },
      }),
    ]);

  const active = contracts.filter((c) => c.status === "ACTIVE");
  const withDays = active.map((c) => ({ contract: c, days: daysUntil(c.endDate) }));

  const expiringSoon = withDays
    .filter((c) => c.days != null && c.days >= 0 && c.days <= 30)
    .sort((a, b) => (a.days as number) - (b.days as number));

  const expired = withDays.filter((c) => c.days != null && c.days < 0);

  const activeCurrencies = [...new Set(active.map((c) => c.currency))];
  const fxPairs = activeCurrencies.map((from) => ({ from, to: preferredCurrency }));
  await refreshFxRates(fxPairs);
  const rateMap = await getFxRateMap(fxPairs);

  const unconvertedCurrencies = new Set<string>();
  const monthlySpend = active.reduce((sum, c) => {
    if (c.cost == null) return sum;
    const converted = convertAmount(c.cost, c.currency, preferredCurrency, rateMap);
    if (converted == null) {
      unconvertedCurrencies.add(c.currency);
      return sum;
    }
    return sum + monthlyEquivalent(converted, c.billingFrequency);
  }, 0);
  const hasUnconvertedSpend = unconvertedCurrencies.size > 0;
  if (hasUnconvertedSpend) {
    console.warn(
      `[dashboard] "Est. monthly spend" excludes contracts billed in ${[...unconvertedCurrencies].join(", ")} — FX rate(s) to ${preferredCurrency} unavailable.`,
    );
  }

  // #303: a contract with a cost but no billing frequency contributes $0 to
  // "Est. monthly spend" (monthlyEquivalent has no frequency to convert
  // from) — without this notice that reads as the total being wrong rather
  // than as an unset field.
  const missingFrequencyCount = active.filter(
    (c) => c.cost != null && c.billingFrequency == null,
  ).length;
  const hasMissingFrequencySpend = missingFrequencyCount > 0;

  const productsWithDays = products.map((p) => ({
    product: p,
    days: daysUntil(p.warrantyEndDate),
  }));

  const warrantiesExpiringSoon = productsWithDays
    .filter((p) => p.days != null && p.days >= 0 && p.days <= 30)
    .sort((a, b) => (a.days as number) - (b.days as number));

  const warrantiesExpired = productsWithDays.filter((p) => p.days != null && p.days < 0);

  const vehiclesNeedingAttention = vehicles.filter((v) => {
    const rego = daysUntil(v.regoExpiry);
    const insurance = daysUntil(v.insuranceExpiry);
    const service = daysUntil(v.nextServiceDue);
    return (
      (rego != null && rego <= 30) ||
      (insurance != null && insurance <= 30) ||
      (service != null && service <= 30)
    );
  });

  // Every overdue-or-soon-to-expire record in one urgency-sorted list, each
  // with its next action already decided rather than left for the user to
  // work out (#170). Cancelled contracts are excluded via `active`, same
  // basis as expiringSoon/expired above.
  const needsAttentionItems = sortAttentionItems([
    ...buildContractAttentionItems(active),
    ...buildWarrantyAttentionItems(products),
    ...(enabledModules.has("VEHICLES") ? buildVehicleAttentionItems(vehicles) : []),
    ...buildExtractionReviewItems(contracts, products),
    ...buildReminderFailureItems(failedReminderLogs, contracts, products, vehicles),
    ...(session?.user.role === "ADMIN" && !smtpConfigured && !ntfyConfigured
      ? [buildReminderNudgeItem()]
      : []),
  ]);

  const upcomingTrips = trips.filter((t) => {
    const days = daysUntil(t.startDate);
    return days != null && days >= 0 && days <= 30;
  });

  const isEmpty = contracts.length === 0 && products.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted">
            What&apos;s expiring, what it costs, and what needs attention.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/import"
            className="flex min-h-11 items-center gap-2 rounded-lg border border-accent/40 px-4 py-2 text-sm font-medium text-accent hover:bg-accent/5"
          >
            <Upload size={16} />
            Upload a document
          </Link>
          <AddEntryPicker enabledModules={[...enabledModules]} />
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Documents</h2>
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="Inbox"
            value={String(documentStats.inboxCount)}
            tone={documentStats.inboxCount > 0 ? "warning" : "default"}
            href="/documents/inbox"
          />
          <StatCard
            label="Total documents"
            value={String(documentStats.total)}
            tone="info"
            href="/documents"
          />
        </div>
      </section>

      {isEmpty ? (
        <OnboardingChecklist
          enabledModules={[...enabledModules]}
          memberCount={memberCount}
          remindersConfigured={smtpConfigured || ntfyConfigured}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              label="Active contracts"
              value={String(active.length)}
              href="/contracts?status=ACTIVE"
            />
            <StatCard
              label="Contracts expiring in 30 days"
              value={String(expiringSoon.length)}
              tone={expiringSoon.length > 0 ? "warning" : "default"}
              href="/contracts?status=ACTIVE&expiring=30"
            />
            <StatCard
              label="Contracts expired"
              value={String(expired.length)}
              tone={expired.length > 0 ? "danger" : "default"}
              href="/contracts?status=ACTIVE&expired=true"
            />
            <StatCard
              label="Est. monthly spend"
              value={formatCurrency(monthlySpend, preferredCurrency, undefined, region)}
              tone={hasUnconvertedSpend || hasMissingFrequencySpend ? "warning" : "default"}
              href="/spend"
            />
          </div>
          {hasUnconvertedSpend && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
              <p>
                This total excludes contracts billed in{" "}
                {[...unconvertedCurrencies].join(", ")} — an exchange rate to{" "}
                {preferredCurrency} isn&apos;t available right now.
              </p>
            </div>
          )}
          {hasMissingFrequencySpend && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
              <p>
                {missingFrequencyCount} active {missingFrequencyCount === 1 ? "contract has" : "contracts have"} a
                cost but no billing frequency set — {missingFrequencyCount === 1 ? "it isn't" : "they aren't"}{" "}
                counted in Est. monthly spend yet.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Warranties tracked" value={String(products.length)} href="/products" />
            <StatCard
              label="Warranties expiring in 30 days"
              value={String(warrantiesExpiringSoon.length)}
              tone={warrantiesExpiringSoon.length > 0 ? "warning" : "default"}
              href="/products?expiring=30"
            />
            <StatCard
              label="Warranties expired"
              value={String(warrantiesExpired.length)}
              tone={warrantiesExpired.length > 0 ? "danger" : "default"}
              href="/products?expired=true"
            />
            {enabledModules.has("VEHICLES") && (
              <StatCard
                label="Vehicles needing attention"
                value={String(vehiclesNeedingAttention.length)}
                tone={vehiclesNeedingAttention.length > 0 ? "warning" : "default"}
                href="/vehicles"
              />
            )}
          </div>
        </>
      )}

      <section className="space-y-3">
        <div>
          <h2 className="text-xl font-semibold">Needs attention</h2>
          <p className="text-sm text-muted">
            Every overdue or soon-to-expire contract, warranty and vehicle, with the next
            action already picked out — sorted so the most urgent is first.
          </p>
        </div>
        <NeedsAttentionQueue items={needsAttentionItems} />
      </section>

      {enabledModules.has("TRAVEL") && upcomingTrips.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Upcoming trips</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {upcomingTrips.map((trip) => (
              <TripCard key={trip.id} trip={trip} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
