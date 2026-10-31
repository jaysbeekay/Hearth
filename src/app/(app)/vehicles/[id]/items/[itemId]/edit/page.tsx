import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { updateVehicleItem } from "@/lib/actions/vehicles";
import { VehicleItemForm } from "@/components/VehicleItemForm";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";
import { Card } from "@/components/ui/Card";

export default async function EditVehicleItemPage({
  params,
}: {
  params: Promise<{ id: string; itemId: string }>;
}) {
  await requireModuleEnabled("VEHICLES");

  const { id, itemId } = await params;
  redirectIfReadOnly(await auth(), `/vehicles/${id}`);
  const [vehicle, item] = await Promise.all([
    prisma.vehicle.findUnique({ where: { id } }),
    prisma.vehicleItem.findUnique({ where: { id: itemId } }),
  ]);
  if (!vehicle || vehicle.deletedAt || !item || item.vehicleId !== vehicle.id) notFound();

  const boundAction = updateVehicleItem.bind(null, vehicle.id, item.id);

  return (
    <div className="max-w-3xl space-y-6">
      <BackLink href={`/vehicles/${vehicle.id}`} label={vehicle.label} />
      <div>
        <h1 className="text-2xl font-medium">Edit service record</h1>
        <p className="text-sm text-muted">{vehicle.label}</p>
      </div>
      <Card>
        <VehicleItemForm action={boundAction} item={item} />
      </Card>
    </div>
  );
}
