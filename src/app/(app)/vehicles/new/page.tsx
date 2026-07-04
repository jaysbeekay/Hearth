import { requireModuleEnabled } from "@/lib/modules/enablement";
import { createVehicle } from "@/lib/actions/vehicles";
import { VehicleForm } from "@/components/VehicleForm";

export default async function NewVehiclePage() {
  await requireModuleEnabled("VEHICLES");

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Add a vehicle</h1>
        <p className="text-sm text-foreground/60">
          Track rego, insurance, and service history for this vehicle.
        </p>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <VehicleForm action={createVehicle} />
      </div>
    </div>
  );
}
