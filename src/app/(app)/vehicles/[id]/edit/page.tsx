import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { updateVehicle } from "@/lib/actions/vehicles";
import { VehicleForm } from "@/components/VehicleForm";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";
import { Card, PageShell } from "@/components/ui";

export default async function EditVehiclePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleEnabled("VEHICLES");

  const { id } = await params;
  redirectIfReadOnly(await auth(), `/vehicles/${id}`);
  const vehicle = await prisma.vehicle.findUnique({ where: { id } });
  if (!vehicle || vehicle.deletedAt) notFound();

  const boundAction = updateVehicle.bind(null, vehicle.id);

  return (
    <PageShell width="form">
      <BackLink href={`/vehicles/${vehicle.id}`} label={vehicle.label} />
      <div>
        <h1 className="text-2xl font-medium">Edit vehicle</h1>
        <p className="text-sm text-muted">{vehicle.label}</p>
      </div>
      <Card>
        <VehicleForm action={boundAction} vehicle={vehicle} />
      </Card>
    </PageShell>
  );
}
