import type { Metadata } from "next";
import Link from "next/link";
import { Upload } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { TripCard } from "@/components/TripCard";
import { AddEntryPicker } from "@/components/AddEntryPicker";
import { OnboardingChecklist } from "@/components/OnboardingChecklist";
import { monthlyEquivalent, formatCurrency } from "@/lib/utils";
import { getUserPreferences } from "@/lib/userPreferences";
import { refreshFxRates, getFxRateMap, convertAmount } from "@/lib/fx";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { auth } from "@/lib/auth";
import { isSmtpConfigured, isNtfyConfigured, getDueContext } from "@/lib/appSettings";
import { addDays, calendarDayOf } from "@/lib/duePolicy";
import { currentTenancy, TENANCY_AGREEMENT_SELECT } from "@/lib/dueRecords";
import { getCurrentReminderFailures } from "@/lib/notifications/logs";
import { getDocumentStats } from "@/lib/documents/stats";
import {
  buildContractAttentionItems,
  buildWarrantyAttentionItems,
  buildVehicleAttentionItems,
  buildTenancyAttentionItems,
  buildReminderNudgeItem,
  buildExtractionReviewItems,
  buildReminderFailureItems,
  buildInboxItem,
  buildMissingDetailsItems,
  groupAttentionItems,
} from "@/lib/needsAttention";
import { contractRules, productRules, vehicleRules } from "@/lib/recordFilters";
import { NeedsAttentionQueue } from "@/components/NeedsAttentionQueue";
import { TakePhotoButton } from "@/components/TakePhotoButton";
import { compactButtonClass } from "@/lib/buttonStyles";
import { canWrite as sessionCanWrite } from "@/lib/readOnly";

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

  const [contracts, products, vehicles, trips, properties, memberCount, documentStats, due] =
    await Promise.all([
      prisma.contract.findMany({
        where: { deletedAt: null },
        orderBy: { endDate: "asc" },
        include: { _count: { select: { documents: { where: { deletedAt: null } } } } },
      }),
      prisma.product.findMany({
        where: { deletedAt: null },
        orderBy: { warrantyEndDate: "asc" },
        include: { _count: { select: { documents: { where: { deletedAt: null } } } } },
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
      enabledModules.has("HOME")
        ? prisma.property.findMany({
            where: { deletedAt: null, isRented: true },
            select: {
              id: true,
              label: true,
              isRented: true,
              rentalAgreements: { select: TENANCY_AGREEMENT_SELECT },
            },
          })
        : [],
      prisma.user.count(),
      getDocumentStats(enabledModules),
      // The household's today and default thresholds: every Due row below
      // comes from the Due policy with these (ADR 0002).
      getDueContext(),
    ]);

  // #387 — the Reminder log is keyed by date, so a failure for a date that
  // has since moved or passed is history, as is one a later send replaced;
  // only current ones need attention.
  const currentFailedReminderLogs = await getCurrentReminderFailures(
    {
      CONTRACT: new Map(contracts.map((c) => [c.id, { kind: "contract" as const, ...c }])),
      PRODUCT: new Map(products.map((p) => [p.id, { kind: "warranty" as const, ...p }])),
      VEHICLE: new Map(vehicles.map((v) => [v.id, { kind: "vehicle" as const, ...v }])),
    },
    due,
  );

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

  // #395 — Missing key details, counted with the same rules the lists use
  // (src/lib/recordFilters.ts), so each count is the length of the list its
  // row opens. A cost with no billing frequency (#303, which would otherwise
  // add $0 to the monthly estimate) is part of a Contract's key details.
  const missingDetails = {
    contracts: contracts.filter(contractRules.missingDetails.matches).length,
    warranties: products.filter(productRules.missingDetails.matches).length,
    vehicles: enabledModules.has("VEHICLES") ? vehicles.filter(vehicleRules.missingDetails.matches).length : 0,
  };

  // #356/#357 — the dashboard leads with what needs doing: dated items
  // (Due) first, then records to tidy (Housekeeping), each with its next
  // action already decided (#170). Cancelled Contracts have no Due entries.
  const tenancies = properties.flatMap((property) => {
    const tenancy = currentTenancy(property);
    return tenancy
      ? [{ propertyId: property.id, propertyLabel: property.label, agreementId: tenancy.id, tenantName: tenancy.tenantName, leaseEnd: tenancy.leaseEnd }]
      : [];
  });
  const attention = groupAttentionItems([
    ...buildContractAttentionItems(contracts, due),
    ...buildWarrantyAttentionItems(products, due),
    ...(enabledModules.has("VEHICLES") ? buildVehicleAttentionItems(vehicles, due) : []),
    ...buildTenancyAttentionItems(tenancies, due),
    ...buildReminderFailureItems(currentFailedReminderLogs, contracts, products, vehicles),
    ...buildExtractionReviewItems(contracts, products),
    ...buildInboxItem(documentStats.inboxCount),
    ...buildMissingDetailsItems(missingDetails),
    ...(session?.user.role === "ADMIN" && !smtpConfigured && !ntfyConfigured
      ? [buildReminderNudgeItem()]
      : []),
  ]);

  // Trips are never Due: this is the next 30 days of the household's calendar.
  const tripsUntil = addDays(due.today, 30);
  const upcomingTrips = trips.filter((t) => {
    const start = calendarDayOf(t.startDate);
    return start != null && start >= due.today && start <= tripsUntil;
  });

  const isEmpty = contracts.length === 0 && products.length === 0;
  const canWrite = sessionCanWrite(session);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted">
            What&apos;s expiring, what it costs, and what needs attention.
          </p>
        </div>
        {/* Read-only members can't add or upload, so they get none of these (#400). */}
        {canWrite && (
          <div className="flex items-center gap-2">
            <TakePhotoButton />
            <Link href="/import" className={`${compactButtonClass("secondary")} gap-2`}>
              <Upload size={16} />
              {/* Shortened on phones so it fits beside Take photo and Add. */}
              <span>
                Upload<span className="hidden sm:inline"> a document</span>
              </span>
            </Link>
            <AddEntryPicker enabledModules={[...enabledModules]} />
          </div>
        )}
      </div>

      {!canWrite && <p className="text-sm text-muted">You have read-only access.</p>}

      {isEmpty && !canWrite ? (
        <p className="text-sm text-muted">Nothing has been added yet.</p>
      ) : isEmpty ? (
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
        <NeedsAttentionQueue due={attention.due} housekeeping={attention.housekeeping} canWrite={canWrite} />
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
