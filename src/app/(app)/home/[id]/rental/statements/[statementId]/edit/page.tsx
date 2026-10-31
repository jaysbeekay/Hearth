import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { updateRentalStatement } from "@/lib/actions/home";
import { RentalStatementForm } from "@/components/RentalStatementForm";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";
import { Card, PageShell } from "@/components/ui";

export default async function EditRentalStatementPage({
  params,
}: {
  params: Promise<{ id: string; statementId: string }>;
}) {
  await requireModuleEnabled("HOME");

  const { id, statementId } = await params;
  redirectIfReadOnly(await auth(), `/home/${id}/rental`);
  const statement = await prisma.rentalStatement.findUnique({ where: { id: statementId } });
  if (!statement || statement.deletedAt || statement.propertyId !== id) notFound();

  const property = await prisma.property.findUnique({ where: { id } });
  if (!property || property.deletedAt) notFound();

  const boundAction = updateRentalStatement.bind(null, property.id, statementId);

  return (
    <PageShell width="form">
      <div>
        <BackLink href={`/home/${property.id}/rental`} label="Tenancy" />
      </div>

      <div>
        <p className="text-sm text-muted">{property.label}</p>
        <h1 className="text-2xl font-medium">Edit statement</h1>
      </div>

      <Card>
        <RentalStatementForm action={boundAction} statement={statement} />
      </Card>
    </PageShell>
  );
}
