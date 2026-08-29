import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Trash2, Ban, RotateCcw, Home, ArrowLeft, Car } from "lucide-react";
import { prisma } from "@/lib/prisma";
import {
  addDocument,
  deleteContract,
  setContractStatus,
  confirmContractExtraction,
  reviewContractExtraction,
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
  daysUntil,
  formatCurrency,
  formatDate,
} from "@/lib/utils";
import { getUserPreferences } from "@/lib/userPreferences";
import { getHouseholdMemberCount } from "@/lib/household";

export default async function ContractDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ docFallback?: string }>;
}) {
  const { id } = await params;
  const { docFallback } = await searchParams;
  const [contract, { dateFormat, region }, memberCount] = await Promise.all([
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
  ]);
  if (!contract || contract.deletedAt) notFound();

  const pendingReview = contract.extractionPending
    ? await getPendingExtractionReview("CONTRACT", contract.id)
    : [];

  const days = daysUntil(contract.endDate);
  const cancelled = contract.status === "CANCELLED";
  const boundUpload = addDocument.bind(null, contract.id);
  const reminderHealth = await getReminderHealth({
    ownerType: "CONTRACT",
    ownerId: contract.id,
    targetDate: contract.endDate,
    reminderDaysBefore: contract.reminderDaysBefore,
  });

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link
          href="/contracts"
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft size={16} />
          Back to contracts
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted">
            {CATEGORY_LABELS[contract.category] ?? contract.category}
          </p>
          <h1 className="text-2xl font-semibold">{contract.title}</h1>
          <p className="text-foreground/70">{contract.provider}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExpiryBadge days={days} cancelled={cancelled} />
          <Link
            href={`/contracts/${contract.id}/edit`}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
          >
            <Pencil size={16} />
            Edit
          </Link>
          <ConfirmForm
            action={setContractStatus.bind(
              null,
              contract.id,
              cancelled ? "ACTIVE" : "CANCELLED",
            )}
            confirmText={
              cancelled
                ? "Mark this contract as active again?"
                : "Mark this contract as cancelled? This just changes its status — it won't delete the contract or its documents."
            }
            actionLabel={cancelled ? "Mark as active" : "Mark as cancelled"}
            ariaLabel={cancelled ? "Mark contract as active" : "Mark contract as cancelled"}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
          >
            {cancelled ? <RotateCcw size={16} /> : <Ban size={16} />}
            {cancelled ? "Mark as active" : "Mark as cancelled"}
          </ConfirmForm>
          <DetailOverflowMenu>
            <ConfirmForm
              action={deleteContract.bind(null, contract.id)}
              confirmText="Move this contract to Trash? Its documents are kept, and you can restore it within 30 days from Settings → Trash."
              actionLabel="Delete contract"
              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-danger hover:bg-danger/10"
              offline={{ entity: "contract", entityId: contract.id, label: `Delete contract: ${contract.title}` }}
            >
              <Trash2 size={16} />
              Delete
            </ConfirmForm>
          </DetailOverflowMenu>
        </div>
      </div>

      <DocFallbackBanner docFallback={docFallback} />

      {!cancelled && (
        <DetailStatusBanner
          days={days}
          hasDocuments={contract.documents.length > 0}
          documentsHref="#documents"
          editHref={`/contracts/${contract.id}/edit`}
          renewLabel="Renew policy"
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
          <Detail label="Contract / policy number" value={contract.contractNumber ?? "—"} copyable />
          <Detail label="Start date" value={formatDate(contract.startDate, dateFormat)} />
          <Detail label="End date" value={formatDate(contract.endDate, dateFormat)} />
          <Detail
            label="Renewal type"
            value={RENEWAL_LABELS[contract.renewalType] ?? contract.renewalType}
          />
          <Detail
            label="Notice period"
            value={contract.noticePeriodDays != null ? `${contract.noticePeriodDays} days` : "—"}
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
        <ReminderHealthCard health={reminderHealth} dateFormat={dateFormat} />
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
          <p className="whitespace-pre-wrap text-sm text-foreground/80">{contract.notes}</p>
        </div>
      )}

      {(contract.property || contract.vehicle) && (
        <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
          <h2 className="mb-3 font-medium">Linked to</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {contract.property && (
              <Link
                href={`/home/${contract.property.id}`}
                className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-black/5 dark:hover:bg-white/5"
              >
                <Home size={18} className="text-muted" />
                <span>
                  <span className="block text-sm font-medium">{contract.property.label}</span>
                  <span className="block text-xs text-muted">Home or property</span>
                </span>
              </Link>
            )}
            {contract.vehicle && (
              <Link
                href={`/vehicles/${contract.vehicle.id}`}
                className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-black/5 dark:hover:bg-white/5"
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
            <h2 className="font-medium">Linked rental agreement</h2>
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
            View rental overview →
          </Link>
        </div>
      )}

      <div id="documents" className="scroll-mt-20 rounded-xl border border-border bg-surface p-4 md:p-6">
        <h2 className="mb-3 font-medium">Documents</h2>
        <DocumentList documents={contract.documents} dateFormat={dateFormat} />
        <div className="mt-4 border-t border-border pt-4">
          <DocumentUploadForm action={boundUpload} />
        </div>
      </div>

      <RecordMeta
        createdByName={contract.createdBy.name}
        updatedByName={contract.updatedBy?.name}
        createdAt={contract.createdAt}
        updatedAt={contract.updatedAt}
        dateFormat={dateFormat}
        extractionConfirmedAt={contract.extractionConfirmedAt}
        memberCount={memberCount}
      />
    </div>
  );
}
