import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { updateInventoryItem } from "@/lib/actions/inventory";
import { InventoryItemForm } from "@/components/InventoryItemForm";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";

export const metadata: Metadata = { title: "Edit Item" };

export default async function EditInventoryItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleEnabled("INVENTORY");

  const { id } = await params;
  redirectIfReadOnly(await auth(), `/inventory/${id}`);
  const item = await prisma.inventoryItem.findUnique({ where: { id } });
  if (!item || item.deletedAt) notFound();
  // The linked warranty stays an option even while it's in Trash: otherwise
  // the select would post it blank and saving would unlink it (#413).
  const products = (
    await prisma.product.findMany({
      where: item.warrantyProductId
        ? { OR: [{ deletedAt: null }, { id: item.warrantyProductId }] }
        : { deletedAt: null },
      select: { id: true, description: true, deletedAt: true },
      orderBy: { description: "asc" },
    })
  ).map((p) => ({ id: p.id, description: p.deletedAt ? `${p.description} (in Trash)` : p.description }));

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <BackLink href={`/inventory/${id}`} label={item.label} />
      </div>
      <h1 className="text-2xl font-medium">Edit item</h1>
      <InventoryItemForm action={updateInventoryItem.bind(null, id)} item={item} products={products} />
    </div>
  );
}
