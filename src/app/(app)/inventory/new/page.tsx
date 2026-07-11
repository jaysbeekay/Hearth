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
      <div>
        <h1 className="text-2xl font-semibold">Add item</h1>
        <p className="mt-1 text-xs text-muted">
          Inventory is a catalogue of what you own — no warranty tracking. Need to track a
          warranty instead? Try{" "}
          <Link href="/products/new" className="text-accent hover:underline">
            add a product
          </Link>
          .
        </p>
      </div>
      <InventoryItemForm action={createInventoryItem} />
    </div>
  );
}
