import type { Metadata } from "next";
import Link from "next/link";
import { Upload } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { TripCard } from "@/components/TripCard";
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
  buildInboxItem,
  buildMissingInfoItems,
  buildMissingFrequencyItem,
  groupAttentionItems,
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
  if (unconvertedCurrencies.size > 0) {
    console.warn(
      `[dashboard] Monthly spend excludes contracts billed in ${[...unconvertedCurrencies].join(", ")} — FX rate(s) to ${preferredCurrency} unavailable.`,
    );
  }

  // #303: a contract with a cost but no billing frequency contributes $0 to
  // the monthly estimate (monthlyEquivalent has no frequency to convert
  // from) — surfaced as a housekeeping row so the total doesn't just look wrong.
  const missingFrequencyCount = active.filter(
    (c) => c.cost != null && c.billingFrequency == null,
  ).length;

  // #328 — a completeness gap (no end date, no policy/serial number),
  // independent of urgency: mirrors the narrower missingInfo filter
  // contracts/products list pages support (see the comment there for why
  // reminder/relationship gaps aren't folded into this aggregate).
  const contractsMissingInfo = active.filter(
    (c) => c.endDate == null || c.contractNumber == null,
  ).length;
  const warrantiesMissingInfo = products.filter(
    (p) => p.warrantyEndDate == null || (p.serialNumber == null && p.barcode == null),
  ).length;

  // #356/#357 — the dashboard leads with what needs doing: dated items
  // (Due) first, then records to tidy (Housekeeping), each with its next
  // action already decided (#170). Cancelled contracts are excluded via `active`.
  const { due, housekeeping } = groupAttentionItems([
    ...buildContractAttentionItems(active),
    ...buildWarrantyAttentionItems(products),
    ...(enabledModules.has("VEHICLES") ? buildVehicleAttentionItems(vehicles) : []),
    ...buildReminderFailureItems(failedReminderLogs, contracts, products, vehicles),
    ...buildExtractionReviewItems(contracts, products),
    ...buildInboxItem(documentStats.inboxCount),
    ...buildMissingInfoItems(contractsMissingInfo, warrantiesMissingInfo),
    ...buildMissingFrequencyItem(missingFrequencyCount),
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

      {isEmpty ? (
        <OnboardingChecklist
          enabledModules={[...enabledModules]}
          memberCount={memberCount}
          remindersConfigured={smtpConfigured || ntfyConfigured}
        />
      ) : (
        <p className="text-sm text-muted">
          <Link href="/contracts?status=ACTIVE" className="text-foreground hover:underline">
            {active.length} active {active.length === 1 ? "contract" : "contracts"}
          </Link>
          {" · "}
          <Link href="/products" className="text-foreground hover:underline">
            {products.length} {products.length === 1 ? "warranty" : "warranties"}
          </Link>
          {" · "}
          <Link href="/spend" className="text-foreground hover:underline">
            about {formatCurrency(monthlySpend, preferredCurrency, undefined, region)} a month
          </Link>
          {unconvertedCurrencies.size > 0 && (
            <> (excludes {[...unconvertedCurrencies].join(", ")}: no exchange rate right now)</>
          )}
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Needs attention</h2>
        <NeedsAttentionQueue due={due} housekeeping={housekeeping} />
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
