import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Trash2, Plus, Wrench, Tag, RotateCw, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { deleteVehicle, deleteVehicleItem, addVehicleItemDocument } from "@/lib/actions/vehicles";
import { ConfirmForm } from "@/components/ConfirmForm";
import { DetailField as Detail } from "@/components/DetailField";
import { DetailOverflowMenu } from "@/components/DetailOverflowMenu";
import { DocumentUploadForm } from "@/components/DocumentUploadForm";
import { VehicleItemDocumentList } from "@/components/VehicleItemDocumentList";
import { RecordMeta } from "@/components/RecordMeta";
import { ContractCard } from "@/components/ContractCard";
import { ReminderHealthCard } from "@/components/ReminderHealthCard";
import { getReminderHealth } from "@/lib/notifications/health";
import { VEHICLE_ITEM_TYPE_LABELS, formatCurrency, formatDate } from "@/lib/utils";
import { getUserPreferences } from "@/lib/userPreferences";
import { getHouseholdMemberCount } from "@/lib/household";

const ITEM_ICONS: Record<string, LucideIcon> = {
  SERVICE: Wrench,
  REPAIR: Wrench,
  ROADWORTHY: RotateCw,
  MODIFICATION: Zap,
  OTHER: Tag,
};

export default async function VehicleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleEnabled("VEHICLES");

  const { id } = await params;
  const [vehicle, { dateFormat, region }, linkedContracts, memberCount] = await Promise.all([
    prisma.vehicle.findUnique({
      where: { id },
      include: {
        createdBy: true,
        updatedBy: true,
        items: { include: { documents: { orderBy: { uploadedAt: "desc" } } } },
      },
    }),
    getUserPreferences(),
    prisma.contract.findMany({ where: { vehicleId: id, deletedAt: null }, orderBy: { title: "asc" } }),
    getHouseholdMemberCount(),
  ]);
  if (!vehicle || vehicle.deletedAt) notFound();

  const [regoHealth, insuranceHealth] = await Promise.all([
    vehicle.regoExpiry
      ? getReminderHealth({
          ownerType: "VEHICLE",
          ownerId: vehicle.id,
          field: "regoExpiry",
          targetDate: vehicle.regoExpiry,
          reminderDaysBefore: vehicle.reminderDaysBefore,
        })
      : null,
    vehicle.insuranceExpiry
      ? getReminderHealth({
          ownerType: "VEHICLE",
          ownerId: vehicle.id,
          field: "insuranceExpiry",
          targetDate: vehicle.insuranceExpiry,
          reminderDaysBefore: vehicle.reminderDaysBefore,
        })
      : null,
  ]);

  const items = [...vehicle.items].sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.getTime() - a.date.getTime();
  });

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/vehicles" className="text-sm text-muted hover:text-foreground">
          ← Back to vehicles
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{vehicle.label}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/vehicles/${vehicle.id}/edit`}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
          >
            <Pencil size={16} />
            Edit
          </Link>
          <DetailOverflowMenu>
            <ConfirmForm
              action={deleteVehicle.bind(null, vehicle.id)}
              confirmText="Move this vehicle to Trash? Its records and documents are kept, and you can restore it within 30 days from Settings → Trash."
              actionLabel="Delete vehicle"
              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-danger hover:bg-danger/10"
              offline={{ entity: "vehicle", entityId: vehicle.id, label: `Delete vehicle: ${vehicle.label}` }}
            >
              <Trash2 size={16} />
              Delete
            </ConfirmForm>
          </DetailOverflowMenu>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {vehicle.make && <Detail label="Make" value={vehicle.make} />}
          {vehicle.model && <Detail label="Model" value={vehicle.model} />}
          {vehicle.year && <Detail label="Year" value={String(vehicle.year)} />}
          {vehicle.licensePlate && (
            <Detail label="License plate" value={vehicle.licensePlate} copyable />
          )}
          {vehicle.regoExpiry && (
            <Detail label="Rego expiry" value={formatDate(vehicle.regoExpiry, dateFormat)} />
          )}
          {vehicle.insuranceExpiry && (
            <Detail
              label="Insurance expiry"
              value={formatDate(vehicle.insuranceExpiry, dateFormat)}
            />
          )}
          {vehicle.vin && <Detail label="VIN" value={vehicle.vin} copyable />}
          {vehicle.colour && <Detail label="Colour" value={vehicle.colour} />}
        </dl>
        {vehicle.notes && (
          <p className="mt-4 whitespace-pre-wrap text-sm text-foreground/80">{vehicle.notes}</p>
        )}
      </div>

      {regoHealth && (
        <ReminderHealthCard title="Registration reminder" health={regoHealth} dateFormat={dateFormat} />
      )}
      {insuranceHealth && (
        <ReminderHealthCard title="Insurance reminder" health={insuranceHealth} dateFormat={dateFormat} />
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Contracts &amp; warranties linked to this vehicle</h2>
          <Link
            href={`/contracts/new?vehicleId=${vehicle.id}`}
            className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
          >
            <Plus size={16} />
            Add contract
          </Link>
        </div>
        {linkedContracts.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
            No contracts or warranties linked yet.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {linkedContracts.map((contract) => (
              <ContractCard key={contract.id} contract={contract} dateFormat={dateFormat} region={region} />
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Service &amp; records</h2>
          <Link
            href={`/vehicles/${vehicle.id}/items/new`}
            className="flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
          >
            <Plus size={16} />
            Add record
          </Link>
        </div>

        {items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted">
            No records yet. Add a service, repair, or registration record to start tracking.
          </p>
        ) : (
          <div className="space-y-3">
            {items.map((item) => {
              const Icon = ITEM_ICONS[item.type] ?? Tag;
              return (
                <div
                  key={item.id}
                  className="rounded-xl border border-border bg-surface p-4 md:p-6"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <Icon size={20} className="mt-0.5 shrink-0 text-muted" />
                      <div className="min-w-0">
                        <p className="text-sm text-muted">
                          {VEHICLE_ITEM_TYPE_LABELS[item.type] ?? item.type}
                        </p>
                        <p className="font-medium">{item.title}</p>
                        {item.provider && (
                          <p className="text-sm text-foreground/70">{item.provider}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/vehicles/${vehicle.id}/items/${item.id}/edit`}
                        className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
                      >
                        <Pencil size={16} />
                        Edit
                      </Link>
                      <ConfirmForm
                        action={deleteVehicleItem.bind(null, vehicle.id, item.id)}
                        confirmText={`Delete "${item.title}" and its documents?`}
                        actionLabel={`Delete "${item.title}"`}
                        className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-danger hover:bg-danger/10"
                      >
                        <Trash2 size={16} />
                        Delete
                      </ConfirmForm>
                    </div>
                  </div>

                  <dl className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3">
                    <Detail label="Date" value={formatDate(item.date, dateFormat)} />
                    <Detail
                      label="Cost"
                      value={item.cost != null ? formatCurrency(item.cost, item.currency, undefined, region) : "—"}
                    />
                  </dl>

                  {item.notes && (
                    <p className="mt-4 whitespace-pre-wrap text-sm text-foreground/80">
                      {item.notes}
                    </p>
                  )}

                  <div className="mt-4 border-t border-border pt-4">
                    <h3 className="mb-2 text-sm font-medium">Documents</h3>
                    <VehicleItemDocumentList documents={item.documents} dateFormat={dateFormat} />
                    <div className="mt-3">
                      <DocumentUploadForm action={addVehicleItemDocument.bind(null, item.id)} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <RecordMeta
        createdByName={vehicle.createdBy.name}
        updatedByName={vehicle.updatedBy?.name}
        createdAt={vehicle.createdAt}
        updatedAt={vehicle.updatedAt}
        dateFormat={dateFormat}
        memberCount={memberCount}
      />
    </div>
  );
}
