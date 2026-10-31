import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { addVehicleItem } from "@/lib/actions/vehicles";
import { VehicleItemForm } from "@/components/VehicleItemForm";
import { getUserPreferences } from "@/lib/userPreferences";
import { BackLink } from "@/components/BackLink";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { Card } from "@/components/ui";

export default async function NewVehicleItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleEnabled("VEHICLES");

  const { id } = await params;
  redirectIfReadOnly(await auth(), `/vehicles/${id}`);
  const [vehicle, { preferredCurrency }] = await Promise.all([
    prisma.vehicle.findUnique({ where: { id } }),
    getUserPreferences(),
  ]);
  if (!vehicle || vehicle.deletedAt) notFound();

  const boundAction = addVehicleItem.bind(null, vehicle.id);

  return (
    <div className="max-w-3xl space-y-6">
      <BackLink href={`/vehicles/${vehicle.id}`} label={vehicle.label} />
      <div>
        <h1 className="text-2xl font-medium">Add service record</h1>
        <p className="text-sm text-muted">{vehicle.label}</p>
      </div>
      <Card>
        <VehicleItemForm action={boundAction} vehicleId={vehicle.id} defaultCurrency={preferredCurrency} />
      </Card>
    </div>
  );
}
