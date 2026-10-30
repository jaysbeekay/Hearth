import Link from "next/link";
import { BackLink } from "@/components/BackLink";
import { notFound } from "next/navigation";
import { Pencil, Trash2, Ban, RotateCcw, Home, Car } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { addDocumentAction } from "@/lib/actions/documents";
import {
  deleteContract,
  setContractStatus,
  confirmContractExtraction,
  reviewContractExtraction,
  restoreContract,
} from "@/lib/actions/contracts";
import { getPendingExtractionReview } from "@/lib/documents/extractionReview";
import { ExpiryBadge } from "@/components/ExpiryBadge";
import { ConfirmForm } from "@/components/ConfirmForm";
import { DetailOverflowMenu } from "@/components/DetailOverflowMenu";
import { DetailStatusBanner } from "@/components/DetailStatusBanner";
import { ExtractionReviewPanel } from "@/components/ExtractionReviewPanel";
import { DetailField as Detail } from "@/components/DetailField";
import { DocumentUploadForm } from "@/components/DocumentUploadForm";
import { DocumentList } from "@/components/DocumentList";
import { RecordMeta } from "@/components/RecordMeta";
import { ReminderHealthCard } from "@/components/ReminderHealthCard";
import { getReminderHealth } from "@/lib/notifications/health";
import { DocFallbackBanner } from "@/components/DocFallbackBanner";
import {
  CATEGORY_LABELS,
  BILLING_LABELS,
  RENEWAL_LABELS,
  formatCurrency,
  formatDate,
} from "@/lib/utils";
import { getUserPreferences } from "@/lib/userPreferences";
import { getDueContext } from "@/lib/appSettings";
import { addDays, calendarDayOf, noticeApplies } from "@/lib/duePolicy";
import { contractDue, headlineEntry } from "@/lib/dueRecords";
import { getHouseholdMemberCount } from "@/lib/household";
import { auth } from "@/lib/auth";
import { canWrite as sessionCanWrite } from "@/lib/readOnly";

export default async function ContractDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ docFallback?: string }>;
}) {
  const { id } = await params;
  const { docFallback } = await searchParams;
  const canWrite = sessionCanWrite(await auth());
  const [contract, { dateFormat, region }, memberCount, due] = await Promise.all([
    prisma.contract.findUnique({
      where: { id },
      include: {
        documents: { where: { deletedAt: null }, orderBy: { uploadedAt: "desc" } },
        createdBy: true,
        updatedBy: true,
        property: true,
        vehicle: true,
        rentalAgreement: { include: { property: true } },
      },
    }),
    getUserPreferences(),
    getHouseholdMemberCount(),
    getDueContext(),
  ]);
  if (!contract || contract.deletedAt) notFound();

  const pendingReview = contract.extractionPending
    ? await getPendingExtractionReview("CONTRACT", contract.id)
    : [];

  // #384 — the badge and banner show the Due policy's entry: the notice
  // deadline while it's ahead (#351), then the end date.
  const dueEntries = contractDue(contract, due);
  const entry = headlineEntry(dueEntries);
  // The notice deadline as a date, for the Notice period field.
  const endDay = calendarDayOf(contract.endDate);
  const noticeDeadline = endDay && noticeApplies(contract) ? addDays(endDay, -(contract.noticePeriodDays ?? 0)) : null;
  const cancelled = contract.status === "CANCELLED";
  const fixedTerm = contract.renewalType === "FIXED_TERM";
  const boundUpload = addDocumentAction.bind(null, "CONTRACT", contract.id);
  const statusAction = setContractStatus.bind(null, contract.id, cancelled ? "ACTIVE" : "CANCELLED");
  const statusLabel = cancelled ? "Mark as active" : "Mark as cancelled";
  const statusConfirmText = cancelled
    ? "Mark this contract as active again?"
    : "Mark this contract as cancelled? This just changes its status — it won't delete the contract or its documents.";
  const reminderHealth = await getReminderHealth({
    ownerType: "CONTRACT",
    ownerId: contract.id,
    record: { kind: "contract", ...contract },
  });

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <BackLink href="/contracts" label="Contracts" />
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted">
            {CATEGORY_LABELS[contract.category] ?? contract.category}
          </p>
          <h1 className="text-2xl font-semibold">{contract.title}</h1>
          <p className="text-muted">{contract.provider}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExpiryBadge entry={entry} cancelled={cancelled} />
          {canWrite && (
            <>
              <Link
                href={`/contracts/${contract.id}/edit`}
                className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-hover"
              >
                <Pencil size={16} />
                Edit
              </Link>
              {/* #370 — status changes are rare, so they sit in the overflow
                  menu next to Delete (and in the expiry banner when it's
                  relevant), keeping the header to one row on mobile. */}
              <DetailOverflowMenu>
                <ConfirmForm
                  action={statusAction}
                  confirmText={statusConfirmText}
                  actionLabel={statusLabel}
                  ariaLabel={cancelled ? "Mark contract as active" : "Mark contract as cancelled"}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm hover:bg-hover"
                >
                  {cancelled ? <RotateCcw size={16} /> : <Ban size={16} />}
                  {statusLabel}
                </ConfirmForm>
                <ConfirmForm
                  action={deleteContract.bind(null, contract.id)}
                  undo={{ action: restoreContract.bind(null, contract.id), href: `/contracts/${contract.id}` }}
                  confirmText="Move this contract to Trash? Its documents are kept, and you can restore it within 30 days from Settings → Trash."
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-danger hover:bg-danger/10"
                  offline={{ entity: "contract", entityId: contract.id, label: `Delete contract: ${contract.title}` }}
                >
                  <Trash2 size={16} />
                  Delete
                </ConfirmForm>
              </DetailOverflowMenu>
            </>
          )}
        </div>
      </div>

      <DocFallbackBanner docFallback={docFallback} />

      {!cancelled && (
        <DetailStatusBanner
          entries={dueEntries}
          hasDocuments={contract.documents.length > 0}
          documentsHref="#documents"
          editHref={`/contracts/${contract.id}/edit`}
          // A fixed-term Contract is meant to end: nothing to renew, and
          // nothing to give notice of.
          renewLabel={fixedTerm ? undefined : "Renew"}
          newEndDateMessage="Renewed automatically, so its end date has passed."
          // Expiring is exactly when "I'm not renewing this" is the other
          // likely answer, so offer it beside Renew.
          secondaryAction={
            fixedTerm ? undefined : (
              <ConfirmForm
                action={statusAction}
                confirmText={statusConfirmText}
                actionLabel={statusLabel}
                ariaLabel="Mark contract as cancelled"
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-hover-surface"
              >
                <Ban size={14} />
                Not renewing? Mark as cancelled
              </ConfirmForm>
            )
          }
          needsReview={
            contract.extractionPending && pendingReview.length === 0
              ? { onConfirm: confirmContractExtraction.bind(null, contract.id) }
              : undefined
          }
        />
      )}

      {pendingReview.length > 0 && (
        <ExtractionReviewPanel fields={pendingReview} action={reviewContractExtraction.bind(null, contract.id)} />
      )}

      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <Detail label="Contract number" value={contract.contractNumber ?? "—"} copyable />
          <Detail label="Start date" value={formatDate(contract.startDate, dateFormat)} />
          <Detail label="End date" value={formatDate(contract.endDate, dateFormat)} />
          <Detail
            label="Renewal type"
            value={RENEWAL_LABELS[contract.renewalType] ?? contract.renewalType}
          />
          <Detail
            label="Notice period"
            value={
              contract.noticePeriodDays != null
                ? `${contract.noticePeriodDays} days${
                    noticeDeadline ? ` · give notice by ${formatDate(noticeDeadline, dateFormat)}` : ""
                  }`
                : "—"
            }
          />
          <Detail
            label="Cost"
            value={
              contract.cost != null
                ? `${formatCurrency(contract.cost, contract.currency, undefined, region)}${
                    contract.billingFrequency
                      ? ` / ${BILLING_LABELS[contract.billingFrequency]?.toLowerCase()}`
                      : ""
                  }`
                : "—"
            }
          />
        </dl>
      </div>

      {!cancelled && contract.endDate && (
        <ReminderHealthCard
          health={reminderHealth}
          dateFormat={dateFormat}
          testTarget={{ kind: "contract", id: contract.id }}
        />
      )}

      {(contract.contactName || contract.contactPhone || contract.contactEmail) && (
        <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
          <h2 className="mb-3 font-medium">Contact details</h2>
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <Detail label="Name" value={contract.contactName ?? "—"} />
            <Detail label="Phone" value={contract.contactPhone ?? "—"} />
            <Detail label="Email" value={contract.contactEmail ?? "—"} />
          </dl>
        </div>
      )}

      {contract.notes && (
        <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
          <h2 className="mb-2 font-medium">Notes</h2>
          <p className="whitespace-pre-wrap text-sm text-foreground">{contract.notes}</p>
        </div>
      )}

      {(contract.property || contract.vehicle) && (
        <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
          <h2 className="mb-3 font-medium">Linked to</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {contract.property && (
              <Link
                href={`/home/${contract.property.id}`}
                className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-hover"
              >
                <Home size={18} className="text-muted" />
                <span>
                  <span className="block text-sm font-medium">{contract.property.label}</span>
                  <span className="block text-xs text-muted">Property</span>
                </span>
              </Link>
            )}
            {contract.vehicle && (
              <Link
                href={`/vehicles/${contract.vehicle.id}`}
                className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-hover"
              >
                <Car size={18} className="text-muted" />
                <span>
                  <span className="block text-sm font-medium">{contract.vehicle.label}</span>
                  <span className="block text-xs text-muted">Vehicle</span>
                </span>
              </Link>
            )}
          </div>
        </div>
      )}

      {contract.category === "RENTAL" && contract.rentalAgreement && (
        <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
          <div className="mb-3 flex items-center gap-2">
            <Home size={18} className="text-muted" />
            <h2 className="font-medium">Linked tenancy</h2>
          </div>
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <Detail
              label="Property"
              value={contract.rentalAgreement.property.label}
            />
            <Detail label="Tenant" value={contract.rentalAgreement.tenantName ?? "—"} />
            <Detail
              label="Weekly rent"
              value={formatCurrency(
                contract.rentalAgreement.weeklyRent,
                contract.rentalAgreement.currency,
                undefined,
                region,
              )}
            />
            <Detail
              label="Lease period"
              value={
                contract.rentalAgreement.leaseStart || contract.rentalAgreement.leaseEnd
                  ? `${formatDate(contract.rentalAgreement.leaseStart, dateFormat)} – ${formatDate(contract.rentalAgreement.leaseEnd, dateFormat)}`
                  : "—"
              }
            />
          </dl>
          <Link
            href={`/home/${contract.rentalAgreement.propertyId}/rental`}
            className="mt-3 inline-block text-sm font-medium text-accent hover:underline"
          >
            View tenancy →
          </Link>
        </div>
      )}

      <div id="documents" className="scroll-mt-20 rounded-xl border border-border bg-surface p-4 md:p-6">
        <h2 className="mb-3 font-medium">Documents</h2>
        <DocumentList documents={contract.documents} />
        {canWrite && (
          <div className="mt-4 border-t border-border pt-4">
            <DocumentUploadForm action={boundUpload} />
          </div>
        )}
      </div>

      <RecordMeta
        createdByName={contract.createdBy.name}
        updatedByName={contract.updatedBy?.name}
        createdAt={contract.createdAt}
        updatedAt={contract.updatedAt}
        extractionConfirmedAt={contract.extractionConfirmedAt}
        memberCount={memberCount}
      />
    </div>
  );
}
