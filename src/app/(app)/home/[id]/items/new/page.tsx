import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { addHomeItem } from "@/lib/actions/home";
import { HomeItemForm } from "@/components/HomeItemForm";
import { getUserPreferences } from "@/lib/userPreferences";

export default async function NewHomeItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleEnabled("HOME");

  const { id } = await params;
  const [property, { preferredCurrency }] = await Promise.all([
    prisma.property.findUnique({ where: { id } }),
    getUserPreferences(),
  ]);
  if (!property) notFound();

  const boundAction = addHomeItem.bind(null, property.id);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Add an item</h1>
        <p className="text-sm text-foreground/60">{property.label}</p>
        <p className="mt-1 text-xs text-muted">
          Log a repair, maintenance visit, or improvement for this property, with receipts
          attached.
        </p>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <HomeItemForm action={boundAction} propertyId={property.id} defaultCurrency={preferredCurrency} />
      </div>
    </div>
  );
}
