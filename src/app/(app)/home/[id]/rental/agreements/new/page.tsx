import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { createRentalAgreement } from "@/lib/actions/home";
import { RentalAgreementForm } from "@/components/RentalAgreementForm";
import { getUserPreferences } from "@/lib/userPreferences";
import { getReminderConfig } from "@/lib/appSettings";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";

export default async function NewRentalAgreementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleEnabled("HOME");

  const { id } = await params;
  redirectIfReadOnly(await auth(), `/home/${id}/rental`);
  const [property, { preferredCurrency }, { defaultDays }] = await Promise.all([
    prisma.property.findUnique({ where: { id } }),
    getUserPreferences(),
    getReminderConfig(),
  ]);
  if (!property || property.deletedAt) notFound();

  const boundAction = createRentalAgreement.bind(null, property.id);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <BackLink href={`/home/${property.id}/rental`} label="Tenancy" />
      </div>

      <div>
        <p className="text-sm text-muted">{property.label}</p>
        <h1 className="text-2xl font-semibold">New tenancy</h1>
        <p className="mt-1 text-sm text-muted">
          Record a tenancy for this property. Add a new one whenever the rent, tenant or terms
          change, so the history is kept for reconciliation.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <RentalAgreementForm
          action={boundAction}
          propertyId={property.id}
          defaultCurrency={preferredCurrency}
          defaultReminderDays={defaultDays}
        />
      </div>
    </div>
  );
}
