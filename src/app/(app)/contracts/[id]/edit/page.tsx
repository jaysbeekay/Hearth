import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { updateContract } from "@/lib/actions/contracts";
import { ContractForm } from "@/components/ContractForm";
import { isModuleEnabled } from "@/lib/modules/enablement";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";
import { Card } from "@/components/ui/Card";
import { PageShell } from "@/components/ui/PageShell";
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
    <PageShell width="form">
      <BackLink href={`/contracts/${contract.id}`} label={contract.title} />
      <div>
        <h1 className="text-2xl font-medium">Edit contract</h1>
        <p className="text-sm text-muted">{contract.title}</p>
      </div>
      <Card>
        <ContractForm
          action={boundAction}
          contract={contract}
          properties={properties}
          vehicles={vehicles}
          homeEnabled={homeEnabled}
          vehiclesEnabled={vehiclesEnabled}
        />
      </Card>
    </PageShell>
  );
}
