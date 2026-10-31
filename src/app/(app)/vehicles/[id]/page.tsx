import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Trash2, Plus, Wrench, Tag, RotateCw, Zap, Receipt } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { addDocumentAction } from "@/lib/actions/documents";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import {
  archiveVehicle,
  deleteVehicle,
  deleteVehicleItem,
  restoreVehicle,
  restoreVehicleItem,
  unarchiveVehicle,
} from "@/lib/actions/vehicles";
import { ArchiveButton } from "@/components/ArchiveButton";
import { ArchivedNotice } from "@/components/ArchivedNotice";
import { ConfirmForm } from "@/components/ConfirmForm";
import { DetailField as Detail } from "@/components/DetailField";
import { DetailOverflowMenu } from "@/components/DetailOverflowMenu";
import { DocumentUploadForm } from "@/components/DocumentUploadForm";
import { DocumentList } from "@/components/DocumentList";
import { getTrashedVersionLinks } from "@/lib/documents/trashedVersionLinks";
import { RecordMeta } from "@/components/RecordMeta";
import { ContractCard } from "@/components/ContractCard";
import { ReminderHealthCard } from "@/components/ReminderHealthCard";
import { getReminderHealth } from "@/lib/notifications/health";
import { VEHICLE_ITEM_TYPE_LABELS, formatCurrency, formatDate } from "@/lib/utils";
import { getUserPreferences } from "@/lib/userPreferences";
import { getHouseholdMemberCount } from "@/lib/household";
import { getDueContext } from "@/lib/appSettings";
import { vehicleDue } from "@/lib/dueRecords";
import { DetailStatusBanner } from "@/components/DetailStatusBanner";
import { auth } from "@/lib/auth";
import { canWrite as sessionCanWrite } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";
import { buttonClass } from "@/lib/buttonStyles";
import { Card, EmptyState, PageShell } from "@/components/ui";

const ITEM_ICONS: Record<string, LucideIcon> = {
  SERVICE: Wrench,
  REPAIR: Wrench,
  ROADWORTHY: RotateCw,
  MODIFICATION: Zap,
  PURCHASE: Receipt,
  OTHER: Tag,
};

export default async function VehicleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleEnabled("VEHICLES");

  const { id } = await params;
  const canWrite = sessionCanWrite(await auth());
  const [vehicle, { dateFormat, region }, linkedContracts, memberCount, due] = await Promise.all([
    prisma.vehicle.findUnique({
      where: { id },
      include: {
        createdBy: true,
        updatedBy: true,
        items: {
          where: { deletedAt: null },
          include: { documents: { where: { deletedAt: null }, orderBy: { uploadedAt: "desc" } } },
        },
      },
    }),
    getUserPreferences(),
    prisma.contract.findMany({ where: { vehicleId: id, deletedAt: null }, orderBy: { title: "asc" } }),
    getHouseholdMemberCount(),
    getDueContext(),
  ]);
  if (!vehicle || vehicle.deletedAt) notFound();

  const healthFor = (field: "regoExpiry" | "insuranceExpiry" | "nextServiceDue", date: Date | null) =>
    // An Archived Vehicle has no Reminders to report on (#355).
    date && !vehicle.archivedAt
      ? getReminderHealth({ ownerType: "VEHICLE", ownerId: vehicle.id, field, record: { kind: "vehicle", ...vehicle } })
      : null;
  const [regoHealth, insuranceHealth, serviceHealth] = await Promise.all([
    healthFor("regoExpiry", vehicle.regoExpiry),
    healthFor("insuranceExpiry", vehicle.insuranceExpiry),
    healthFor("nextServiceDue", vehicle.nextServiceDue),
  ]);

  const trashedLinks = await getTrashedVersionLinks(
    "VEHICLE_ITEM",
    vehicle.items.map((i) => i.id),
  );
  const items = [...vehicle.items].sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.getTime() - a.date.getTime();
  });

  return (
    <PageShell width="detail">
      <div>
        <BackLink href="/vehicles" label="Vehicles" />
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium">{vehicle.label}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canWrite && (
            <>
              <Link
                href={`/vehicles/${vehicle.id}/edit`}
                className={buttonClass("secondary")}
              >
                <Pencil size={16} />
                Edit
              </Link>
              <DetailOverflowMenu>
                {!vehicle.archivedAt && (
                  <ArchiveButton
                    mode="archive"
                    noun="vehicle"
                    action={archiveVehicle.bind(null, vehicle.id)}
                    undo={unarchiveVehicle.bind(null, vehicle.id)}
                    className="flex min-h-11 w-full items-center gap-2 px-4 py-2 text-sm hover:bg-hover"
                  />
                )}
                <ConfirmForm
                  action={deleteVehicle.bind(null, vehicle.id)}
                  undo={{ action: restoreVehicle.bind(null, vehicle.id), href: `/vehicles/${vehicle.id}` }}
                  confirmText="Move this vehicle to Trash? Its service records and documents are kept, and you can restore it within 30 days from Settings → Trash."
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-danger hover:bg-danger/10"
                  offline={{ entity: "vehicle", entityId: vehicle.id, label: `Delete vehicle: ${vehicle.label}` }}
                >
                  <Trash2 size={16} />
                  Delete
                </ConfirmForm>
              </DetailOverflowMenu>
            </>
          )}
        </div>
      </div>

      {vehicle.archivedAt && (
        <ArchivedNotice
          archivedAt={vehicle.archivedAt}
          dateFormat={dateFormat}
          effect="Reminders and Needs attention no longer include its rego, insurance or service dates."
          activeContracts={linkedContracts.filter((c) => c.status === "ACTIVE")}
        >
          {canWrite && (
            <ArchiveButton
              mode="restore"
              noun="vehicle"
              action={unarchiveVehicle.bind(null, vehicle.id)}
              className={buttonClass("secondary")}
            />
          )}
        </ArchivedNotice>
      )}

      {/* #384 — one row per Due entry (rego, insurance, service), each with
          its own state from the Due policy. An Archived Vehicle has none. */}
      <DetailStatusBanner
        entries={vehicleDue(vehicle, due)}
        hasDocuments
        documentsHref={`/vehicles/${vehicle.id}`}
        editHref={`/vehicles/${vehicle.id}/edit`}
        renewLabel="Update dates"
      />

      <Card>
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {vehicle.make && <Detail label="Make" value={vehicle.make} />}
          {vehicle.model && <Detail label="Model" value={vehicle.model} />}
          {vehicle.year && <Detail label="Year" value={String(vehicle.year)} />}
          {vehicle.licensePlate && (
            <Detail label="Licence plate" value={vehicle.licensePlate} copyable />
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
          {vehicle.nextServiceDue && (
            <Detail label="Next service due" value={formatDate(vehicle.nextServiceDue, dateFormat)} />
          )}
          {vehicle.vin && <Detail label="VIN" value={vehicle.vin} copyable />}
          {vehicle.colour && <Detail label="Colour" value={vehicle.colour} />}
        </dl>
        {vehicle.notes && (
          <p className="mt-4 whitespace-pre-wrap text-sm text-foreground">{vehicle.notes}</p>
        )}
      </Card>

      {regoHealth && (
        <ReminderHealthCard
          title="Registration reminder"
          health={regoHealth}
          dateFormat={dateFormat}
          testTarget={{ kind: "vehicle", id: vehicle.id, field: "regoExpiry" }}
        />
      )}
      {insuranceHealth && (
        <ReminderHealthCard
          title="Insurance reminder"
          health={insuranceHealth}
          dateFormat={dateFormat}
          testTarget={{ kind: "vehicle", id: vehicle.id, field: "insuranceExpiry" }}
        />
      )}
      {serviceHealth && (
        <ReminderHealthCard
          title="Service reminder"
          health={serviceHealth}
          dateFormat={dateFormat}
          testTarget={{ kind: "vehicle", id: vehicle.id, field: "nextServiceDue" }}
        />
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Contracts and warranties linked to this vehicle</h2>
          {canWrite && (
            <Link
              href={`/contracts/new?vehicleId=${vehicle.id}`}
              className={buttonClass("secondary", { className: "whitespace-nowrap" })}
            >
              <Plus size={16} />
              Add contract
            </Link>
          )}
        </div>
        {linkedContracts.length === 0 ? (
          <EmptyState as="p">
            No contracts or warranties linked yet.
          </EmptyState>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {linkedContracts.map((contract) => (
              <ContractCard key={contract.id} contract={contract} due={due} dateFormat={dateFormat} region={region} />
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Service records</h2>
          {canWrite && (
            <Link
              href={`/vehicles/${vehicle.id}/items/new`}
              className={buttonClass("secondary")}
            >
              <Plus size={16} />
              Add service record
            </Link>
          )}
        </div>

        {items.length === 0 ? (
          <EmptyState as="p">
            No service records yet. Add a service, repair or roadworthy to start tracking.
          </EmptyState>
        ) : (
          <div className="space-y-3">
            {items.map((item) => {
              const Icon = ITEM_ICONS[item.type] ?? Tag;
              return (
                <Card
                  key={item.id}
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
                          <p className="text-sm text-muted">{item.provider}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {canWrite && (
                        <>
                          <Link
                            href={`/vehicles/${vehicle.id}/items/${item.id}/edit`}
                            className={buttonClass("secondary")}
                          >
                            <Pencil size={16} />
                            Edit
                          </Link>
                          <ConfirmForm
                            action={deleteVehicleItem.bind(null, vehicle.id, item.id)}
                            undo={{ action: restoreVehicleItem.bind(null, item.id) }}
                            confirmText={`Move "${item.title}" to Trash? Its documents are kept, and you can restore it within 30 days from Settings → Trash.`}
                            className={buttonClass("secondary", { className: "text-danger" })}
                          >
                            <Trash2 size={16} />
                            Delete
                          </ConfirmForm>
                        </>
                      )}
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
                    <p className="mt-4 whitespace-pre-wrap text-sm text-foreground">
                      {item.notes}
                    </p>
                  )}

                  <div className="mt-4 border-t border-border pt-4">
                    <h3 className="mb-2 text-sm font-medium">Documents</h3>
                    <DocumentList kind="VEHICLE_ITEM" ownerId={item.id} documents={item.documents} trashedLinks={trashedLinks.get(item.id)} />
                    {canWrite && (
                      <div className="mt-3">
                        <DocumentUploadForm action={addDocumentAction.bind(null, "VEHICLE_ITEM", item.id)} variant="secondary" />
                      </div>
                    )}
                  </div>
                </Card>
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
        memberCount={memberCount}
      />
    </PageShell>
  );
}
