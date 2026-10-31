import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { createRentalStatement } from "@/lib/actions/home";
import { RentalStatementForm } from "@/components/RentalStatementForm";
import { getUserPreferences } from "@/lib/userPreferences";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";
import { Card } from "@/components/ui";

export default async function NewRentalStatementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleEnabled("HOME");

  const { id } = await params;
  redirectIfReadOnly(await auth(), `/home/${id}/rental`);
  const [property, { preferredCurrency }] = await Promise.all([
    prisma.property.findUnique({ where: { id } }),
    getUserPreferences(),
  ]);
  if (!property || property.deletedAt) notFound();

  const boundAction = createRentalStatement.bind(null, property.id);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <BackLink href={`/home/${property.id}/rental`} label="Tenancy" />
      </div>

      <div>
        <p className="text-sm text-muted">{property.label}</p>
        <h1 className="text-2xl font-medium">Add rental statement</h1>
        <p className="mt-1 text-sm text-muted">
          Upload your agent&apos;s statement — fields will be auto-filled where possible.
          Expected amounts are calculated from the tenancy for reconciliation.
        </p>
      </div>

      <Card>
        <RentalStatementForm
          action={boundAction}
          propertyId={property.id}
          defaultCurrency={preferredCurrency}
        />
      </Card>
    </div>
  );
}
