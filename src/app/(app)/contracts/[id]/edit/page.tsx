import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { updateContract } from "@/lib/actions/contracts";
import { ContractForm } from "@/components/ContractForm";
import { isModuleEnabled } from "@/lib/modules/enablement";

export default async function EditContractPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [contract, homeEnabled, vehiclesEnabled] = await Promise.all([
    prisma.contract.findUnique({ where: { id } }),
    isModuleEnabled("HOME"),
    isModuleEnabled("VEHICLES"),
  ]);
  if (!contract) notFound();

  const properties = homeEnabled
    ? await prisma.property.findMany({ select: { id: true, label: true }, orderBy: { label: "asc" } })
    : [];
  const vehicles = vehiclesEnabled
    ? await prisma.vehicle.findMany({ select: { id: true, label: true }, orderBy: { label: "asc" } })
    : [];

  const boundAction = updateContract.bind(null, contract.id);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Edit contract</h1>
        <p className="text-sm text-foreground/60">{contract.title}</p>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <ContractForm
          action={boundAction}
          contract={contract}
          properties={properties}
          vehicles={vehicles}
        />
      </div>
    </div>
  );
}
