import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { createRentalAgreement } from "@/lib/actions/home";
import { RentalAgreementForm } from "@/components/RentalAgreementForm";
import { getUserPreferences } from "@/lib/userPreferences";

export default async function NewRentalAgreementPage({
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

  const boundAction = createRentalAgreement.bind(null, property.id);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link
          href={`/home/${property.id}/rental`}
          className="text-sm text-foreground/60 hover:text-foreground"
        >
          ← Back to rental overview
        </Link>
      </div>

      <div>
        <p className="text-sm text-foreground/60">{property.label}</p>
        <h1 className="text-2xl font-semibold">Add rental agreement</h1>
        <p className="mt-1 text-sm text-foreground/60">
          Record a new rental agreement period — add a new one whenever rent, tenant, or terms
          change so the history is preserved for reconciliation.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <RentalAgreementForm action={boundAction} defaultCurrency={preferredCurrency} />
      </div>
    </div>
  );
}
