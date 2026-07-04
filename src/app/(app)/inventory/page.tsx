import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { InventoryListClient } from "@/components/InventoryListClient";

export default async function InventoryPage() {
  await requireModuleEnabled("INVENTORY");

  const items = await prisma.inventoryItem.findMany({
    include: { _count: { select: { documents: true } } },
    orderBy: { createdAt: "desc" },
  });

  return <InventoryListClient items={items} />;
}
