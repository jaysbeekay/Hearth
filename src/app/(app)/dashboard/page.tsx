import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Sparkles } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { ContractCard } from "@/components/ContractCard";
import { ProductCard } from "@/components/ProductCard";
import { VehicleCard } from "@/components/VehicleCard";
import { TripCard } from "@/components/TripCard";
import { StatCard } from "@/components/StatCard";
import { daysUntil, monthlyEquivalent, formatCurrency } from "@/lib/utils";
import { getUserPreferences } from "@/lib/userPreferences";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { MODULE_REGISTRY } from "@/lib/modules/registry";

export const metadata: Metadata = { title: "Dashboard" };

function OnboardingHero({ enabledModules }: { enabledModules: Set<string> }) {
  return (
    <section className="space-y-4 rounded-xl border border-dashed border-accent/40 bg-accent/5 p-6 text-center md:p-10">
      <Sparkles className="mx-auto text-accent" size={28} />
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Add your first document</h2>
        <p className="mx-auto max-w-md text-sm text-muted">
          Drop in a PDF and Hearth fills in the details for you — review and save in seconds.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Link
          href="/contracts/new"
          className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
        >
          <Plus size={16} />
          Add a contract
        </Link>
        <Link
          href="/products/new"
          className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
        >
          <Plus size={16} />
          Add a warranty
        </Link>
        {[...enabledModules].map((key) => {
          const mod = MODULE_REGISTRY[key as keyof typeof MODULE_REGISTRY];
          if (!mod) return null;
          const Icon = mod.icon;
          return (
            <Link
              key={key}
              href={mod.href}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
            >
              <Icon size={16} />
              {mod.label}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export default async function DashboardPage() {
  const [enabledModules, { preferredCurrency }] = await Promise.all([
    getEnabledModuleKeys(),
    getUserPreferences(),
  ]);

  const [contracts, products, vehicles, trips] = await Promise.all([
    prisma.contract.findMany({ orderBy: { endDate: "asc" } }),
    prisma.product.findMany({ orderBy: { warrantyEndDate: "asc" } }),
    enabledModules.has("VEHICLES") ? prisma.vehicle.findMany({ orderBy: { createdAt: "desc" } }) : [],
    enabledModules.has("TRAVEL")
      ? prisma.trip.findMany({
          orderBy: { startDate: "asc" },
          include: { _count: { select: { segments: true } } },
        })
      : [],
  ]);

  const active = contracts.filter((c) => c.status === "ACTIVE");
  const withDays = active.map((c) => ({ contract: c, days: daysUntil(c.endDate) }));

  const expiringSoon = withDays
    .filter((c) => c.days != null && c.days >= 0 && c.days <= 30)
    .sort((a, b) => (a.days as number) - (b.days as number));

  const expired = withDays.filter((c) => c.days != null && c.days < 0);

  // Only sum contracts in the user's preferred currency — summing raw numbers
  // across different currencies would produce a meaningless total.
  const matchingCurrency = active.filter((c) => c.currency === preferredCurrency);
  const otherCurrencyCount = active.length - matchingCurrency.length;
  const monthlySpend = matchingCurrency.reduce(
    (sum, c) => sum + monthlyEquivalent(c.cost, c.billingFrequency),
    0,
  );

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
    return (rego != null && rego <= 30) || (insurance != null && insurance <= 30);
  });

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
            href="/contracts/new"
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
          >
            <Plus size={16} />
            Add contract
          </Link>
          <Link
            href="/products/new"
            className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
          >
            <Plus size={16} />
            Add product
          </Link>
        </div>
      </div>

      {isEmpty ? (
        <OnboardingHero enabledModules={enabledModules} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Active contracts" value={String(active.length)} />
            <StatCard
              label="Contracts expiring in 30 days"
              value={String(expiringSoon.length)}
              tone={expiringSoon.length > 0 ? "warning" : "default"}
            />
            <StatCard
              label="Contracts expired"
              value={String(expired.length)}
              tone={expired.length > 0 ? "danger" : "default"}
            />
            <StatCard
              label="Est. monthly spend"
              value={
                formatCurrency(monthlySpend, preferredCurrency) + (otherCurrencyCount > 0 ? "*" : "")
              }
            />
          </div>
          {otherCurrencyCount > 0 && (
            <p className="text-xs text-muted">
              * Excludes {otherCurrencyCount} contract{otherCurrencyCount === 1 ? "" : "s"} billed in a
              different currency.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Products tracked" value={String(products.length)} />
            <StatCard
              label="Warranties expiring in 30 days"
              value={String(warrantiesExpiringSoon.length)}
              tone={warrantiesExpiringSoon.length > 0 ? "warning" : "default"}
            />
            <StatCard
              label="Warranties expired"
              value={String(warrantiesExpired.length)}
              tone={warrantiesExpired.length > 0 ? "danger" : "default"}
            />
            {enabledModules.has("VEHICLES") && (
              <StatCard
                label="Vehicles needing attention"
                value={String(vehiclesNeedingAttention.length)}
                tone={vehiclesNeedingAttention.length > 0 ? "warning" : "default"}
              />
            )}
          </div>
        </>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Contracts expiring soon</h2>
        {expiringSoon.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
            Nothing expiring in the next 30 days.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {expiringSoon.map(({ contract }) => (
              <ContractCard key={contract.id} contract={contract} />
            ))}
          </div>
        )}
      </section>

      {expired.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Contracts expired</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {expired.map(({ contract }) => (
              <ContractCard key={contract.id} contract={contract} />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Warranties expiring soon</h2>
        {warrantiesExpiringSoon.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
            Nothing expiring in the next 30 days.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {warrantiesExpiringSoon.map(({ product }) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </section>

      {warrantiesExpired.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Warranties expired</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {warrantiesExpired.map(({ product }) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>
      )}

      {enabledModules.has("VEHICLES") && vehiclesNeedingAttention.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Vehicles needing attention</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {vehiclesNeedingAttention.map((vehicle) => (
              <VehicleCard key={vehicle.id} vehicle={vehicle} />
            ))}
          </div>
        </section>
      )}

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
