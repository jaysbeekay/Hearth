import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { updateRentalAgreement } from "@/lib/actions/home";
import { RentalAgreementForm } from "@/components/RentalAgreementForm";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";
import { getReminderConfig } from "@/lib/appSettings";

export default async function EditRentalAgreementPage({
  params,
}: {
  params: Promise<{ id: string; agreementId: string }>;
}) {
  await requireModuleEnabled("HOME");

  const { id, agreementId } = await params;
  redirectIfReadOnly(await auth(), `/home/${id}/rental`);
  const agreement = await prisma.rentalAgreement.findUnique({ where: { id: agreementId } });
  if (!agreement || agreement.propertyId !== id) notFound();

  const property = await prisma.property.findUnique({ where: { id } });
  if (!property || property.deletedAt) notFound();

  const boundAction = updateRentalAgreement.bind(null, property.id, agreementId);
  const { defaultDays } = await getReminderConfig();

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <BackLink href={`/home/${property.id}/rental`} label="Tenancy" />
      </div>

      <div>
        <p className="text-sm text-muted">{property.label}</p>
        <h1 className="text-2xl font-semibold">Edit tenancy</h1>
        <p className="mt-1 text-sm text-muted">
          Correct a mistake in this tenancy. To record new terms (new tenant or rent change),
          add a new tenancy instead.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <RentalAgreementForm action={boundAction} agreement={agreement} defaultReminderDays={defaultDays} />
      </div>
    </div>
  );
}
