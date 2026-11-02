import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { updateProperty } from "@/lib/actions/home";
import { PropertyForm } from "@/components/PropertyForm";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";
import { Card } from "@/components/ui/Card";
import { PageShell } from "@/components/ui/PageShell";

export default async function EditPropertyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleEnabled("HOME");

  const { id } = await params;
  redirectIfReadOnly(await auth(), `/home/${id}`);
  const property = await prisma.property.findUnique({ where: { id } });
  if (!property || property.deletedAt) notFound();

  const boundAction = updateProperty.bind(null, property.id);

  return (
    <PageShell width="form">
      <BackLink href={`/home/${property.id}`} label={property.label} />
      <div>
        <h1 className="text-2xl font-medium">Edit property</h1>
        <p className="text-sm text-muted">{property.label}</p>
      </div>
      <Card>
        <PropertyForm cancelHref={`/home/${property.id}`} action={boundAction} property={property} />
      </Card>
    </PageShell>
  );
}
