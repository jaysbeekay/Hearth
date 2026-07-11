import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { addVehicleItem } from "@/lib/actions/vehicles";
import { VehicleItemForm } from "@/components/VehicleItemForm";
import { getUserPreferences } from "@/lib/userPreferences";

export default async function NewVehicleItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleEnabled("VEHICLES");

  const { id } = await params;
  const [vehicle, { preferredCurrency }] = await Promise.all([
    prisma.vehicle.findUnique({ where: { id } }),
    getUserPreferences(),
  ]);
  if (!vehicle) notFound();

  const boundAction = addVehicleItem.bind(null, vehicle.id);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Add a record</h1>
        <p className="text-sm text-foreground/60">{vehicle.label}</p>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <VehicleItemForm action={boundAction} vehicleId={vehicle.id} defaultCurrency={preferredCurrency} />
      </div>
    </div>
  );
}
