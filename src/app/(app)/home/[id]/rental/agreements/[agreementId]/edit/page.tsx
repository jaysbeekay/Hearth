import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { updateRentalAgreement } from "@/lib/actions/home";
import { RentalAgreementForm } from "@/components/RentalAgreementForm";

export default async function EditRentalAgreementPage({
  params,
}: {
  params: Promise<{ id: string; agreementId: string }>;
}) {
  await requireModuleEnabled("HOME");

  const { id, agreementId } = await params;
  const agreement = await prisma.rentalAgreement.findUnique({ where: { id: agreementId } });
  if (!agreement || agreement.propertyId !== id) notFound();

  const property = await prisma.property.findUnique({ where: { id } });
  if (!property) notFound();

  const boundAction = updateRentalAgreement.bind(null, property.id, agreementId);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link
          href={`/home/${property.id}/rental`}
          className="text-sm text-muted hover:text-foreground"
        >
          ← Back to rental overview
        </Link>
      </div>

      <div>
        <p className="text-sm text-muted">{property.label}</p>
        <h1 className="text-2xl font-semibold">Edit rental agreement</h1>
        <p className="mt-1 text-sm text-muted">
          Correct a mistake in this agreement. To record new terms (new tenant or rent change),
          add a new agreement instead.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <RentalAgreementForm action={boundAction} agreement={agreement} />
      </div>
    </div>
  );
}
