import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { updateVehicle } from "@/lib/actions/vehicles";
import { VehicleForm } from "@/components/VehicleForm";

export default async function EditVehiclePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleEnabled("VEHICLES");

  const { id } = await params;
  const vehicle = await prisma.vehicle.findUnique({ where: { id } });
  if (!vehicle) notFound();

  const boundAction = updateVehicle.bind(null, vehicle.id);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Edit vehicle</h1>
        <p className="text-sm text-foreground/60">{vehicle.label}</p>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <VehicleForm action={boundAction} vehicle={vehicle} />
      </div>
    </div>
  );
}
