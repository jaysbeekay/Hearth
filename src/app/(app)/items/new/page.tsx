import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { itemCutoverReadiness } from "@/lib/items/cutoverReadiness";
import { createCatalogItem } from "@/lib/actions/inventory";
import { InventoryItemForm } from "@/components/InventoryItemForm";

export default async function NewItemPage() {
  if (process.env.ITEMS_PREVIEW !== "1" || !(await itemCutoverReadiness()).ready) redirect("/products");
  await requireModuleEnabled("INVENTORY");
  redirectIfReadOnly(await auth(), "/items");
  const products = await prisma.product.findMany({ where: { deletedAt: null }, select: { id: true, description: true }, orderBy: { description: "asc" } });
  return <div className="max-w-xl space-y-6">
    <Link href="/items" className="text-sm text-muted">← Items</Link>
    <header><h1 className="text-2xl font-semibold">Add Item</h1><p className="text-sm text-muted">Add what you own to your household catalog.</p></header>
    <InventoryItemForm action={createCatalogItem} products={products} itemRoute />
    <p className="text-sm text-muted">Need a warranty record first? <Link href="/products/new" className="underline">Add a warranty</Link>.</p>
  </div>;
}
