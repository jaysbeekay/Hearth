import type { Metadata } from "next";
import Link from "next/link";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { createInventoryItem } from "@/lib/actions/inventory";
import { InventoryItemForm } from "@/components/InventoryItemForm";

export const metadata: Metadata = { title: "Add Item" };

export default async function NewInventoryItemPage() {
  await requireModuleEnabled("INVENTORY");

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <Link href="/inventory" className="text-sm text-foreground/60 hover:text-foreground">
          ← Back to inventory
        </Link>
      </div>
      <h1 className="text-2xl font-semibold">Add item</h1>
      <InventoryItemForm action={createInventoryItem} />
    </div>
  );
}
