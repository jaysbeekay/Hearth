import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { updateProperty } from "@/lib/actions/home";
import { PropertyForm } from "@/components/PropertyForm";

export default async function EditPropertyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleEnabled("HOME");

  const { id } = await params;
  const property = await prisma.property.findUnique({ where: { id } });
  if (!property) notFound();

  const boundAction = updateProperty.bind(null, property.id);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Edit property</h1>
        <p className="text-sm text-muted">{property.label}</p>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <PropertyForm action={boundAction} property={property} />
      </div>
    </div>
  );
}
