import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { HomeListClient } from "@/components/HomeListClient";
import { financialYearLabel, sumByYear } from "@/lib/utils";
import { getUserPreferences } from "@/lib/userPreferences";

export default async function HomePage() {
  await requireModuleEnabled("HOME");

  const [properties, taxDeductibleItems, { region }] = await Promise.all([
    prisma.property.findMany({
      include: { _count: { select: { items: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.homeItem.findMany({
      where: { isTaxDeductible: true },
      select: { cost: true, date: true, currency: true },
    }),
    getUserPreferences(),
  ]);
  const taxDeductibleSummary = sumByYear(taxDeductibleItems, financialYearLabel);

  return (
    <HomeListClient
      properties={properties}
      taxDeductibleSummary={taxDeductibleSummary}
      region={region}
    />
  );
}
