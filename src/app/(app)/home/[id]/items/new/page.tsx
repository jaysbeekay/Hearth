import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { addHomeItem } from "@/lib/actions/home";
import { HomeItemForm } from "@/components/HomeItemForm";
import { getUserPreferences } from "@/lib/userPreferences";
import { BackLink } from "@/components/BackLink";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { Card } from "@/components/ui/Card";

export default async function NewHomeItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleEnabled("HOME");

  const { id } = await params;
  redirectIfReadOnly(await auth(), `/home/${id}`);
  const [property, { preferredCurrency }] = await Promise.all([
    prisma.property.findUnique({ where: { id } }),
    getUserPreferences(),
  ]);
  if (!property || property.deletedAt) notFound();

  const boundAction = addHomeItem.bind(null, property.id);

  return (
    <div className="max-w-3xl space-y-6">
      <BackLink href={`/home/${property.id}`} label={property.label} />
      <div>
        <h1 className="text-2xl font-medium">Add maintenance record</h1>
        <p className="text-sm text-muted">{property.label}</p>
        <p className="mt-1 text-xs text-muted">
          Log a repair, maintenance visit, or improvement for this property, with receipts
          attached.
        </p>
      </div>
      <Card>
        <HomeItemForm action={boundAction} propertyId={property.id} defaultCurrency={preferredCurrency} />
      </Card>
    </div>
  );
}
