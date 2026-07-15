import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { createRentalStatement } from "@/lib/actions/home";
import { RentalStatementForm } from "@/components/RentalStatementForm";
import { getUserPreferences } from "@/lib/userPreferences";

export default async function NewRentalStatementPage({
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

  const boundAction = createRentalStatement.bind(null, property.id);

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
        <h1 className="text-2xl font-semibold">Add rental statement</h1>
        <p className="mt-1 text-sm text-foreground/60">
          Upload your agent&apos;s statement — fields will be auto-filled where possible.
          Expected amounts are calculated from your rental agreement for reconciliation.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <RentalStatementForm
          action={boundAction}
          propertyId={property.id}
          defaultCurrency={preferredCurrency}
        />
      </div>
    </div>
  );
}
