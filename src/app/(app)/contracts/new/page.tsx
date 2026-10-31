import Link from "next/link";
import { createContract } from "@/lib/actions/contracts";
import { ContractForm } from "@/components/ContractForm";
import { getUserPreferences } from "@/lib/userPreferences";
import { isModuleEnabled } from "@/lib/modules/enablement";
import { prisma } from "@/lib/prisma";
import { BackLink } from "@/components/BackLink";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { Card } from "@/components/ui/Card";

export default async function NewContractPage({
  searchParams,
}: {
  searchParams: Promise<{ propertyId?: string; vehicleId?: string }>;
}) {
  redirectIfReadOnly(await auth(), "/contracts");
  const [{ preferredCurrency }, homeEnabled, vehiclesEnabled, { propertyId, vehicleId }] = await Promise.all([
    getUserPreferences(),
    isModuleEnabled("HOME"),
    isModuleEnabled("VEHICLES"),
    searchParams,
  ]);
  const properties = homeEnabled
    ? await prisma.property.findMany({
        where: { deletedAt: null, archivedAt: null },
        select: { id: true, label: true },
        orderBy: { label: "asc" },
      })
    : [];
  const vehicles = vehiclesEnabled
    ? await prisma.vehicle.findMany({
        where: { deletedAt: null, archivedAt: null },
        select: { id: true, label: true },
        orderBy: { label: "asc" },
      })
    : [];

  return (
    <div className="max-w-3xl space-y-6">
      <BackLink href="/contracts" label="Contracts" />
      <div>
        <h1 className="text-2xl font-medium">Add a contract</h1>
        <p className="text-sm text-muted">
          Capture the key details so you never miss a renewal or cancellation deadline.
        </p>
        <p className="mt-1 text-xs text-muted">
          Contracts have a term or a recurring cost — insurance, a phone plan, a lease, a loan.
          For something you bought that&apos;s under warranty, try{" "}
          <Link href="/products/new" className="text-accent hover:underline">
            add a warranty
          </Link>{" "}
          instead.
        </p>
      </div>
      <Card>
        <ContractForm
          action={createContract}
          defaultCurrency={preferredCurrency}
          properties={properties}
          vehicles={vehicles}
          defaultPropertyId={propertyId}
          defaultVehicleId={vehicleId}
          homeEnabled={homeEnabled}
          vehiclesEnabled={vehiclesEnabled}
        />
      </Card>
    </div>
  );
}
