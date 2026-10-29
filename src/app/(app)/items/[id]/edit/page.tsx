import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { prisma } from "@/lib/prisma";
import { isModuleEnabled } from "@/lib/modules/enablement";
import { itemCutoverReadiness } from "@/lib/items/cutoverReadiness";
import { updateCatalogItem } from "@/lib/actions/inventory";
import { InventoryItemForm } from "@/components/InventoryItemForm";

export default async function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.ITEMS_PREVIEW !== "1" || !(await itemCutoverReadiness()).ready) redirect("/products");
  const { id } = await params;
  redirectIfReadOnly(await auth(), `/items/${id}`);
  const item = await prisma.item.findUnique({ where: { id }, include: { legacyInventories: true } });
  if (!item || item.deletedAt) notFound();
  const inventory = await prisma.inventoryItem.findMany({ where: { id: { in: item.legacyInventories.map((source) => source.inventoryItemId) } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  if (!inventory.length || !(await isModuleEnabled("INVENTORY"))) {
    if (item.legacyProductId) redirect(`/products/${item.legacyProductId}/edit`);
    notFound();
  }
  const source = inventory[0];
  const products = (await prisma.product.findMany({ where: source.warrantyProductId
    ? { OR: [{ deletedAt: null }, { id: source.warrantyProductId }] }
    : { deletedAt: null }, select: { id: true, description: true, deletedAt: true }, orderBy: { description: "asc" } }))
    .map((product) => ({ id: product.id, description: product.deletedAt ? `${product.description} (in Trash)` : product.description }));
  return <div className="max-w-xl space-y-6">
    <Link href={`/items/${id}`} className="text-sm text-muted">← {item.description}</Link>
    <header><h1 className="text-2xl font-semibold">Edit Item</h1>{inventory.length > 1 && <p className="text-sm text-muted">This Item combines {inventory.length} inventory records. Edits apply to the oldest linked record; review its merge conflicts after saving.</p>}</header>
    <InventoryItemForm action={updateCatalogItem.bind(null, source.id)} item={source} products={products} itemRoute />
    {item.legacyProductId && <Link className="text-sm underline" href={`/products/${item.legacyProductId}/edit`}>Edit warranty details</Link>}
  </div>;
}
