import { buttonClass } from "@/lib/ui";
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { itemCutoverReadiness } from "@/lib/items/cutoverReadiness";
import { isModuleEnabled } from "@/lib/modules/enablement";
import { auth } from "@/lib/auth";
import { canWrite } from "@/lib/readOnly";
import { getUserPreferences } from "@/lib/userPreferences";
import { formatDate } from "@/lib/utils";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Items" };

/** Hidden preview until all Item writers and readers can cut over. */
export default async function ItemsPage() {
  if (process.env.ITEMS_PREVIEW !== "1" || !(await itemCutoverReadiness()).ready) redirect("/products");
  const [items, inventoryEnabled, session, { dateFormat }] = await Promise.all([
    prisma.item.findMany({ where: { deletedAt: null }, include: { warranty: true }, orderBy: { description: "asc" } }),
    isModuleEnabled("INVENTORY"), auth(), getUserPreferences(),
  ]);
  // A <div>: the app layout already provides <main id="main"> (#445 review).
  return <div className="mx-auto max-w-3xl space-y-6 p-6">
    <header className="flex items-start justify-between gap-4"><div><h1 className="text-2xl font-medium">Items</h1><p className="text-muted">What your household owns</p></div>
      {inventoryEnabled && canWrite(session) && <Link href="/items/new" className={buttonClass("secondary")}>Add Item</Link>}
    </header>
    {items.length === 0 ? <p>No Items yet.</p> : <ul className="divide-y rounded-lg border">
      {items.map((item) => <li key={item.id}><Link className="block p-4 hover:bg-muted/10" href={`/items/${item.id}`}>
        <span className="font-medium">{item.description}</span>
        {item.warranty && <span className="ml-2 text-sm text-muted">Warranty{item.warranty.endDate ? ` until ${formatDate(item.warranty.endDate, dateFormat)}` : ""}</span>}
      </Link></li>)}
    </ul>}
  </div>;
}
