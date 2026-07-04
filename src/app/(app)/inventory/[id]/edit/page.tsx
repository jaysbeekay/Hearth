import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { updateInventoryItem } from "@/lib/actions/inventory";
import { InventoryItemForm } from "@/components/InventoryItemForm";

export const metadata: Metadata = { title: "Edit Item" };

export default async function EditInventoryItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleEnabled("INVENTORY");

  const { id } = await params;
  const item = await prisma.inventoryItem.findUnique({ where: { id } });
  if (!item) notFound();

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <Link href={`/inventory/${id}`} className="text-sm text-foreground/60 hover:text-foreground">
          ← Back to item
        </Link>
      </div>
      <h1 className="text-2xl font-semibold">Edit item</h1>
      <InventoryItemForm action={updateInventoryItem.bind(null, id)} item={item} />
    </div>
  );
}
