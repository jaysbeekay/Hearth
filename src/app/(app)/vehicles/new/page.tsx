import { requireModuleEnabled } from "@/lib/modules/enablement";
import { createVehicle } from "@/lib/actions/vehicles";
import { VehicleForm } from "@/components/VehicleForm";
import { BackLink } from "@/components/BackLink";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { Card } from "@/components/ui/Card";

export default async function NewVehiclePage() {
  await requireModuleEnabled("VEHICLES");
  redirectIfReadOnly(await auth(), "/vehicles");

  return (
    <div className="max-w-3xl space-y-6">
      <BackLink href="/vehicles" label="Vehicles" />
      <div>
        <h1 className="text-2xl font-medium">Add a vehicle</h1>
        <p className="text-sm text-muted">
          Track registration, insurance, and service history for this vehicle.
        </p>
      </div>
      <Card>
        <VehicleForm action={createVehicle} />
      </Card>
    </div>
  );
}
