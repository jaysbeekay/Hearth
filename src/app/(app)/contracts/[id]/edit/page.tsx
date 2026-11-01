import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { updateContract } from "@/lib/actions/contracts";
import { ContractForm } from "@/components/ContractForm";
import { isModuleEnabled } from "@/lib/modules/enablement";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";
import { propertyLinkTargets, vehicleLinkTargets } from "@/lib/linkTargets";

export default async function EditContractPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirectIfReadOnly(await auth(), `/contracts/${id}`);
  const [contract, homeEnabled, vehiclesEnabled] = await Promise.all([
    prisma.contract.findUnique({ where: { id } }),
    isModuleEnabled("HOME"),
    isModuleEnabled("VEHICLES"),
  ]);
  if (!contract || contract.deletedAt) notFound();

  const [properties, vehicles] = await Promise.all([
    homeEnabled ? propertyLinkTargets(contract.propertyId) : [],
    vehiclesEnabled ? vehicleLinkTargets(contract.vehicleId) : [],
  ]);

  const boundAction = updateContract.bind(null, contract.id);

  return (
    <div className="max-w-3xl space-y-6">
      <BackLink href={`/contracts/${contract.id}`} label={contract.title} />
      <div>
        <h1 className="text-2xl font-semibold">Edit contract</h1>
        <p className="text-sm text-muted">{contract.title}</p>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <ContractForm
          action={boundAction}
          contract={contract}
          properties={properties}
          vehicles={vehicles}
          homeEnabled={homeEnabled}
          vehiclesEnabled={vehiclesEnabled}
        />
      </div>
    </div>
  );
}
