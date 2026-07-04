import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { HomeListClient } from "@/components/HomeListClient";
import { financialYearLabel, sumByYear } from "@/lib/utils";

export default async function HomePage() {
  await requireModuleEnabled("HOME");

  const properties = await prisma.property.findMany({
    include: { _count: { select: { items: true } } },
    orderBy: { createdAt: "desc" },
  });

  const taxDeductibleItems = await prisma.homeItem.findMany({
    where: { isTaxDeductible: true },
    select: { cost: true, date: true, currency: true },
  });
  const taxDeductibleSummary = sumByYear(taxDeductibleItems, financialYearLabel);

  return <HomeListClient properties={properties} taxDeductibleSummary={taxDeductibleSummary} />;
}
