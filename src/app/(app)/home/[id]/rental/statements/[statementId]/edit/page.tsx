import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { updateRentalStatement } from "@/lib/actions/home";
import { RentalStatementForm } from "@/components/RentalStatementForm";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";

export default async function EditRentalStatementPage({
  params,
}: {
  params: Promise<{ id: string; statementId: string }>;
}) {
  await requireModuleEnabled("HOME");

  const { id, statementId } = await params;
  redirectIfReadOnly(await auth(), `/home/${id}/rental`);
  const statement = await prisma.rentalStatement.findUnique({ where: { id: statementId } });
  if (!statement || statement.propertyId !== id) notFound();

  const property = await prisma.property.findUnique({ where: { id } });
  if (!property || property.deletedAt) notFound();

  const boundAction = updateRentalStatement.bind(null, property.id, statementId);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <BackLink href={`/home/${property.id}/rental`} label="Tenancy" />
      </div>

      <div>
        <p className="text-sm text-muted">{property.label}</p>
        <h1 className="text-2xl font-semibold">Edit statement</h1>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <RentalStatementForm action={boundAction} statement={statement} />
      </div>
    </div>
  );
}
