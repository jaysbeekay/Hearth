import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { getUserPreferences } from "@/lib/userPreferences";
import { InventoryListClient } from "@/components/InventoryListClient";

export default async function InventoryPage() {
  await requireModuleEnabled("INVENTORY");

  const [items, { dateFormat }] = await Promise.all([
    prisma.inventoryItem.findMany({
      include: { _count: { select: { documents: true } } },
      orderBy: { createdAt: "desc" },
    }),
    getUserPreferences(),
  ]);

  return <InventoryListClient items={items} dateFormat={dateFormat} />;
}
