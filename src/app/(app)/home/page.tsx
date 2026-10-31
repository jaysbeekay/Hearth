import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { HomeListClient } from "@/components/HomeListClient";
import { financialYearLabel, sumByYear } from "@/lib/utils";
import { getUserPreferences } from "@/lib/userPreferences";
import { MODULE_REGISTRY } from "@/lib/modules/registry";

export const metadata: Metadata = { title: MODULE_REGISTRY.HOME.label };

export default async function HomePage() {
  await requireModuleEnabled("HOME");

  const propertyCounts = {
    _count: {
      select: {
        items: true,
        contracts: { where: { deletedAt: null } },
        products: { where: { deletedAt: null } },
      },
    },
  };
  const [properties, archivedProperties, taxDeductibleItems, { region }] = await Promise.all([
    prisma.property.findMany({
      where: { deletedAt: null, archivedAt: null },
      include: propertyCounts,
      orderBy: { createdAt: "desc" },
    }),
    // #355 — Archived Properties (sold, or the lease ended) stay on their own list below the rest.
    prisma.property.findMany({
      where: { deletedAt: null, archivedAt: { not: null } },
      include: propertyCounts,
      orderBy: { archivedAt: "desc" },
    }),
    prisma.homeItem.findMany({
      where: { isTaxDeductible: true, property: { deletedAt: null } },
      select: { cost: true, date: true, currency: true },
    }),
    getUserPreferences(),
  ]);
  const taxDeductibleSummary = sumByYear(taxDeductibleItems, financialYearLabel);

  return (
    <HomeListClient
      properties={properties}
      archivedProperties={archivedProperties}
      taxDeductibleSummary={taxDeductibleSummary}
      region={region}
    />
  );
}
