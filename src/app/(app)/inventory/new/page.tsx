import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { createInventoryItem } from "@/lib/actions/inventory";
import { InventoryItemForm } from "@/components/InventoryItemForm";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";
import { PageShell } from "@/components/ui/PageShell";

export const metadata: Metadata = { title: "Add Item" };

export default async function NewInventoryItemPage() {
  await requireModuleEnabled("INVENTORY");
  redirectIfReadOnly(await auth(), "/inventory");

  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    select: { id: true, description: true },
    orderBy: { description: "asc" },
  });

  return (
    <PageShell width="form">
      <div>
        <BackLink href="/inventory" label="Inventory" />
      </div>
      <div>
        <h1 className="text-2xl font-medium">Add item</h1>
        <p className="mt-1 text-xs text-muted">
          Inventory is a catalogue of what you own — no warranty tracking. Need to track a
          warranty instead? Try{" "}
          <Link href="/products/new" className="text-accent hover:underline">
            add a warranty
          </Link>
          .
        </p>
      </div>
      <InventoryItemForm action={createInventoryItem} products={products} />
    </PageShell>
  );
}
