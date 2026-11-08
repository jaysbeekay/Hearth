import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { COVERING_CONTRACTS, vehicleCovers } from "@/lib/covers";
import { formatDate } from "@/lib/utils";
import { getUserPreferences } from "@/lib/userPreferences";
import { getReminderConfig } from "@/lib/appSettings";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { updateVehicle } from "@/lib/actions/vehicles";
import { VehicleForm } from "@/components/VehicleForm";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";
import { Card } from "@/components/ui/Card";
import { PageShell } from "@/components/ui/PageShell";
import { recordMetadata } from "@/lib/recordTitles";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return recordMetadata("vehicle", id, (name) => `Edit ${name}`, "Edit vehicle");
}

export default async function EditVehiclePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleEnabled("VEHICLES");

  const { id } = await params;
  redirectIfReadOnly(await auth(), `/vehicles/${id}`);
  const [vehicle, { dateFormat }, { defaultDays }] = await Promise.all([
    prisma.vehicle.findUnique({ where: { id }, include: { contracts: COVERING_CONTRACTS } }),
    getUserPreferences(),
    getReminderConfig(),
  ]);
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
        <VehicleForm
          cancelHref={`/vehicles/${vehicle.id}`}
          action={boundAction}
          vehicle={vehicle}
          defaultReminderDays={defaultDays}
          covers={vehicleCovers(vehicle.contracts).map((c) => ({
            field: c.field,
            contractId: c.contract.id,
            title: c.contract.title,
            dateLabel: formatDate(c.date, dateFormat),
          }))}
        />
      </Card>
    </PageShell>
  );
}
