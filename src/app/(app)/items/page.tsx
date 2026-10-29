import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { itemCutoverReadiness } from "@/lib/items/cutoverReadiness";
import { isModuleEnabled } from "@/lib/modules/enablement";
import { auth } from "@/lib/auth";
import { canWrite } from "@/lib/readOnly";

/** Hidden preview until all Item writers and readers can cut over. */
export default async function ItemsPage() {
  if (process.env.ITEMS_PREVIEW !== "1" || !(await itemCutoverReadiness()).ready) redirect("/products");
  const [items, inventoryEnabled, session] = await Promise.all([
    prisma.item.findMany({ where: { deletedAt: null }, include: { warranty: true }, orderBy: { description: "asc" } }),
    isModuleEnabled("INVENTORY"), auth(),
  ]);
  return <main className="mx-auto max-w-3xl space-y-6 p-6">
    <header className="flex items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold">Items</h1><p className="text-muted">What your household owns</p></div>
      {inventoryEnabled && canWrite(session) && <Link href="/items/new" className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-hover">Add Item</Link>}
    </header>
    {items.length === 0 ? <p>No Items yet.</p> : <ul className="divide-y rounded-lg border">
      {items.map((item) => <li key={item.id}><Link className="block p-4 hover:bg-muted/10" href={`/items/${item.id}`}>
        <span className="font-medium">{item.description}</span>
        {item.warranty && <span className="ml-2 text-sm text-muted">Warranty{item.warranty.endDate ? ` until ${item.warranty.endDate.toLocaleDateString()}` : ""}</span>}
      </Link></li>)}
    </ul>}
  </main>;
}
