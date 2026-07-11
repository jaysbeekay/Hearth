import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { getUserPreferences } from "@/lib/userPreferences";
import { InventoryListClient } from "@/components/InventoryListClient";

export default async function InventoryPage() {
  await requireModuleEnabled("INVENTORY");

  const [items, { dateFormat }, session] = await Promise.all([
    prisma.inventoryItem.findMany({
      include: { _count: { select: { documents: true } } },
      orderBy: { createdAt: "desc" },
    }),
    getUserPreferences(),
    auth(),
  ]);

  return (
    <InventoryListClient
      items={items}
      dateFormat={dateFormat}
      canWrite={session?.user.role !== "READONLY"}
    />
  );
}
