import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { updateVehicleItem } from "@/lib/actions/vehicles";
import { VehicleItemForm } from "@/components/VehicleItemForm";

export default async function EditVehicleItemPage({
  params,
}: {
  params: Promise<{ id: string; itemId: string }>;
}) {
  await requireModuleEnabled("VEHICLES");

  const { id, itemId } = await params;
  const [vehicle, item] = await Promise.all([
    prisma.vehicle.findUnique({ where: { id } }),
    prisma.vehicleItem.findUnique({ where: { id: itemId } }),
  ]);
  if (!vehicle || !item || item.vehicleId !== vehicle.id) notFound();

  const boundAction = updateVehicleItem.bind(null, vehicle.id, item.id);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Edit record</h1>
        <p className="text-sm text-foreground/60">{vehicle.label}</p>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <VehicleItemForm action={boundAction} item={item} />
      </div>
    </div>
  );
}
