import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Trash2, Plus, Wrench, PaintRoller, Hammer, Tag, Home, TrendingUp, AlertTriangle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { addDocumentAction } from "@/lib/actions/documents";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import {
  archiveProperty,
  deleteProperty,
  deleteHomeItem,
  restoreProperty,
  restoreHomeItem,
  unarchiveProperty,
} from "@/lib/actions/home";
import { ArchiveButton } from "@/components/ArchiveButton";
import { ArchivedNotice } from "@/components/ArchivedNotice";
import { createPropertyValuation, deletePropertyValuation, restorePropertyValuation } from "@/lib/actions/wealth";
import { ConfirmForm } from "@/components/ConfirmForm";
import { DetailField as Detail } from "@/components/DetailField";
import { DetailOverflowMenu } from "@/components/DetailOverflowMenu";
import { DocumentUploadForm } from "@/components/DocumentUploadForm";
import { DocumentList } from "@/components/DocumentList";
import { getTrashedVersionLinks } from "@/lib/documents/trashedVersionLinks";
import { RecordMeta } from "@/components/RecordMeta";
import { PropertyMap } from "@/components/PropertyMap";
import { env } from "@/lib/env";
import { resolveMapTiles } from "@/lib/mapTiles";
import { PropertyValuationForm } from "@/components/PropertyValuationForm";
import { ContractCard } from "@/components/ContractCard";
import { ProductCard } from "@/components/ProductCard";
import {
  HOME_ITEM_TYPE_LABELS,
  OCCUPANCY_STATUS_LABELS,
  formatCurrency,
  formatDate,
  formatPropertyAddress,
} from "@/lib/utils";
import { getUserPreferences } from "@/lib/userPreferences";
import { getHouseholdMemberCount } from "@/lib/household";
import { getDueContext } from "@/lib/appSettings";
import { currentTenancy, tenancyDue, LIVE_TENANCY_AGREEMENTS } from "@/lib/dueRecords";
import { DetailStatusBanner } from "@/components/DetailStatusBanner";
import { auth } from "@/lib/auth";
import { canWrite as sessionCanWrite } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";
import { ReminderHealthCard } from "@/components/ReminderHealthCard";
import { getReminderHealth } from "@/lib/notifications/health";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { Banner } from "@/components/ui/Banner";
import { buttonClass, menuItemClass, emptyStateClass } from "@/lib/ui";
import { PageShell } from "@/components/ui/PageShell";

const ITEM_ICONS: Record<string, LucideIcon> = {
  MAINTENANCE: Wrench,
  IMPROVEMENT: PaintRoller,
  REPAIR: Hammer,
  OTHER: Tag,
};

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function isValuationStale(valuedAt: Date) {
  return Date.now() - valuedAt.getTime() > ONE_YEAR_MS;
}

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleEnabled("HOME");

  const { id } = await params;
  const canWrite = sessionCanWrite(await auth());
  const [property, { dateFormat, preferredCurrency, region }, linkedContracts, linkedProducts, memberCount, due] =
    await Promise.all([
      prisma.property.findUnique({
        where: { id },
        include: {
          createdBy: true,
          updatedBy: true,
          items: {
            where: { deletedAt: null },
            include: { documents: { where: { deletedAt: null }, orderBy: { uploadedAt: "desc" } } },
          },
          valuations: { where: { deletedAt: null }, orderBy: { valuedAt: "desc" } },
          rentalAgreements: LIVE_TENANCY_AGREEMENTS,
        },
      }),
      getUserPreferences(),
      prisma.contract.findMany({ where: { propertyId: id, deletedAt: null }, orderBy: { title: "asc" } }),
      prisma.product.findMany({ where: { propertyId: id, deletedAt: null }, orderBy: { description: "asc" } }),
      getHouseholdMemberCount(),
      getDueContext(),
    ]);
  if (!property || property.deletedAt) notFound();

  // #384 — the current Tenancy's lease end, from the Due policy: Due
  // before it passes, then Housekeeping until the new lease end is set.
  const tenancy = currentTenancy(property);
  // #388 — the lease end gets Reminders like any other Due entry; the card
  // reads the same Reminder schedule the scheduler sends from.
  // An Archived Property has no current Tenancy (#355), so it shows neither a
  // lease banner nor a Reminder card.
  const leaseReminderHealth = tenancy?.leaseEnd
    ? await getReminderHealth({ ownerType: "TENANCY", ownerId: tenancy.id, record: { kind: "tenancy", ...tenancy } })
    : null;

  const latestValuation = property.valuations[0] ?? null;
  const valuationStale = !latestValuation || isValuationStale(latestValuation.valuedAt);

  const trashedLinks = await getTrashedVersionLinks(
    "HOME_ITEM",
    property.items.map((i) => i.id),
  );

  const items = [...property.items].sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.getTime() - a.date.getTime();
  });

  return (
    <PageShell width="detail">
      <div>
        <BackLink href="/home" label="Properties" />
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted">
            {formatPropertyAddress(property) || "No address set"}
          </p>
          <h1 className="text-2xl font-medium">{property.label}</h1>
          <Pill className="mt-1">
            {OCCUPANCY_STATUS_LABELS[property.occupancyStatus] ?? property.occupancyStatus}
          </Pill>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canWrite && (
            <>
              <Link
                href={`/home/${property.id}/edit`}
                className={buttonClass("secondary")}
              >
                <Pencil size={16} />
                Edit
              </Link>
              <DetailOverflowMenu>
                {!property.archivedAt && (
                  <ArchiveButton
                    mode="archive"
                    noun="property"
                    action={archiveProperty.bind(null, property.id)}
                    undo={unarchiveProperty.bind(null, property.id)}
                    className={menuItemClass()}
                  />
                )}
                <ConfirmForm
                  action={deleteProperty.bind(null, property.id)}
                  undo={{ action: restoreProperty.bind(null, property.id), href: `/home/${property.id}` }}
                  confirmText="Delete this property? Its maintenance records and documents are kept, and you can restore it within 30 days from Settings → Recently deleted."
                  className={menuItemClass({ destructive: true })}
                  offline={{ entity: "property", entityId: property.id, label: `Delete property: ${property.label}` }}
                >
                  <Trash2 size={16} />
                  Delete
                </ConfirmForm>
              </DetailOverflowMenu>
            </>
          )}
        </div>
      </div>

      {property.archivedAt && (
        <ArchivedNotice
          archivedAt={property.archivedAt}
          dateFormat={dateFormat}
          effect={property.isRented ? "Reminders and Needs attention no longer include its lease end." : undefined}
          activeContracts={linkedContracts.filter((c) => c.status === "ACTIVE")}
        >
          {canWrite && (
            <ArchiveButton
              mode="restore"
              noun="property"
              action={unarchiveProperty.bind(null, property.id)}
              className={buttonClass("secondary")}
            />
          )}
        </ArchivedNotice>
      )}

      {tenancy && (
        <DetailStatusBanner
          entries={tenancyDue(tenancy, due)}
          hasDocuments
          documentsHref={`/home/${property.id}/rental`}
          editHref={`/home/${property.id}/rental/agreements/${tenancy.id}/edit`}
          renewLabel="Update tenancy"
          newEndDateLabel="Set the new lease end"
          newEndDateMessage="Lease ended."
        />
      )}

      {property.lat != null && property.lng != null && (
        <PropertyMap
          lat={property.lat}
          lng={property.lng}
          label={property.label}
          tiles={resolveMapTiles(env.mapTiles)}
        />
      )}

      {property.notes && (
        <Card>
          <h2 className="mb-2 font-medium">Notes</h2>
          <p className="whitespace-pre-wrap text-sm text-foreground">{property.notes}</p>
        </Card>
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Maintenance records</h2>
          {canWrite && (
            <Link
              href={`/home/${property.id}/items/new`}
              className={buttonClass("secondary")}
            >
              <Plus size={16} />
              Add maintenance record
            </Link>
          )}
        </div>

        {items.length === 0 ? (
          <p className={emptyStateClass()}>
            No maintenance records yet. Add maintenance, an improvement or a repair to start tracking.
          </p>
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
                          {HOME_ITEM_TYPE_LABELS[item.type] ?? item.type}
                        </p>
                        <p className="flex flex-wrap items-center gap-2 font-medium">
                          {item.title}
                          {item.isTaxDeductible && (
                            <Pill>
                              Tax deductible
                            </Pill>
                          )}
                        </p>
                        {item.provider && (
                          <p className="text-sm text-muted">{item.provider}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {canWrite && (
                        <>
                          <Link
                            href={`/home/${property.id}/items/${item.id}/edit`}
                            className={buttonClass("secondary")}
                          >
                            <Pencil size={16} />
                            Edit
                          </Link>
                          <ConfirmForm
                            action={deleteHomeItem.bind(null, property.id, item.id)}
                            undo={{ action: restoreHomeItem.bind(null, item.id) }}
                            confirmText={`Delete "${item.title}"? Its documents are kept, and you can restore it within 30 days from Settings → Recently deleted.`}
                            className={buttonClass("secondary", { destructive: true })}
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
                    <DocumentList kind="HOME_ITEM" ownerId={item.id} documents={item.documents} trashedLinks={trashedLinks.get(item.id)} />
                    {canWrite && (
                      <div className="mt-3">
                        <DocumentUploadForm action={addDocumentAction.bind(null, "HOME_ITEM", item.id)} />
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Contracts and warranties linked to this property</h2>
          {canWrite && (
            <Link
              href={`/contracts/new?propertyId=${property.id}`}
              className={buttonClass("secondary")}
            >
              <Plus size={16} />
              Add contract
            </Link>
          )}
        </div>
        {linkedContracts.length === 0 && linkedProducts.length === 0 ? (
          <p className={emptyStateClass()}>
            No contracts or warranties linked yet.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {linkedContracts.map((contract) => (
              <ContractCard key={contract.id} contract={contract} due={due} dateFormat={dateFormat} region={region} />
            ))}
            {linkedProducts.map((product) => (
              <ProductCard key={product.id} product={product} due={due} dateFormat={dateFormat} region={region} />
            ))}
          </div>
        )}
      </div>

      {/* Property valuations */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp size={16} className="text-muted" />
            <h2 className="font-medium">Property valuations</h2>
          </div>
        </div>

        {valuationStale && (
          <Banner className="flex items-center gap-2">
            <AlertTriangle size={16} className="shrink-0" />
            {latestValuation
              ? "Valuation is over 12 months old — consider updating."
              : "No valuation recorded yet — add one to include this property in your net worth."}
          </Banner>
        )}

        {property.valuations.length > 0 && (
          <Card padding="none" className="divide-y divide-border">
            {property.valuations.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-4 p-4">
                <div>
                  <p className="font-medium">{formatCurrency(v.value, v.currency, undefined, region)}</p>
                  <p className="text-xs text-muted">
                    {formatDate(v.valuedAt, dateFormat)}{v.source ? ` · ${v.source}` : ""}
                  </p>
                  {v.notes && <p className="mt-0.5 text-xs text-foreground">{v.notes}</p>}
                </div>
                {canWrite && (
                  <ConfirmForm
                    action={deletePropertyValuation.bind(null, property.id, v.id)}
                    undo={{ action: restorePropertyValuation.bind(null, v.id) }}
                    offline={{
                      entity: "propertyValuation",
                      entityId: v.id,
                      parentId: property.id,
                      label: `Delete valuation: ${formatDate(v.valuedAt, dateFormat)}`,
                    }}
                    confirmText="Delete this valuation? You can restore it within 30 days from Settings → Recently deleted."
                    ariaLabel={`Delete valuation from ${formatDate(v.valuedAt, dateFormat)}`}
                    className={buttonClass("secondary", { icon: true, destructive: true })}
                  >
                    <Trash2 size={16} />
                  </ConfirmForm>
                )}
              </div>
            ))}
          </Card>
        )}

        {canWrite && (
          <Card>
            <h3 className="mb-3 text-sm font-medium">Add valuation</h3>
            <PropertyValuationForm
              action={createPropertyValuation.bind(null, property.id)}
              propertyId={property.id}
              defaultCurrency={preferredCurrency}
            />
          </Card>
        )}
      </div>

      {/* #232 — offering rental tracking on a property that isn't rented
          (and never has been) is a dead-end prompt. Show the card once the
          owner marks the property RENTED, or once tracking already has data
          (isRented — set independently of occupancyStatus when a rental
          agreement is created, so existing tracking stays visible even if
          occupancyStatus later changes). */}
      {(property.occupancyStatus === "RENTED" || property.isRented) && (
        <Card>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Home size={16} className="text-muted" />
              <h2 className="font-medium">Tenancy</h2>
            </div>
            {property.isRented ? (
              <Link
                href={`/home/${property.id}/rental`}
                className="text-sm font-medium text-accent hover:underline"
              >
                View tenancy →
              </Link>
            ) : (
              <Link
                href={`/home/${property.id}/rental`}
                className={buttonClass("secondary")}
              >
                Set up rental tracking
              </Link>
            )}
          </div>
          {property.isRented && (
            <p className="mt-2 text-sm text-muted">
              This property is rented — track statements and reconcile rent income.
            </p>
          )}
        </Card>
      )}

      {tenancy && leaseReminderHealth && (
        <ReminderHealthCard
          title="Lease reminders"
          health={leaseReminderHealth}
          dateFormat={dateFormat}
          testTarget={{ kind: "tenancy", id: tenancy.id }}
        />
      )}

      <RecordMeta
        createdByName={property.createdBy.name}
        updatedByName={property.updatedBy?.name}
        createdAt={property.createdAt}
        updatedAt={property.updatedAt}
        memberCount={memberCount}
      />
    </PageShell>
  );
}
