import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Trash2, Ban, RotateCcw, Home } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { addDocument, deleteContract, setContractStatus } from "@/lib/actions/contracts";
import { ExpiryBadge } from "@/components/ExpiryBadge";
import { ConfirmForm } from "@/components/ConfirmForm";
import { DocumentUploadForm } from "@/components/DocumentUploadForm";
import { DocumentList } from "@/components/DocumentList";
import {
  CATEGORY_LABELS,
  BILLING_LABELS,
  RENEWAL_LABELS,
  daysUntil,
  formatCurrency,
  formatDate,
} from "@/lib/utils";
import { getUserPreferences } from "@/lib/userPreferences";

export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [contract, { dateFormat }] = await Promise.all([
    prisma.contract.findUnique({
      where: { id },
      include: {
        documents: { orderBy: { uploadedAt: "desc" } },
        createdBy: true,
        rentalAgreement: { include: { property: true } },
      },
    }),
    getUserPreferences(),
  ]);
  if (!contract) notFound();

  const days = daysUntil(contract.endDate);
  const cancelled = contract.status === "CANCELLED";
  const boundUpload = addDocument.bind(null, contract.id);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/contracts" className="text-sm text-foreground/60 hover:text-foreground">
          ← Back to contracts
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-foreground/60">
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
                : "Mark this contract as cancelled?"
            }
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
          >
            {cancelled ? <RotateCcw size={16} /> : <Ban size={16} />}
            {cancelled ? "Reactivate" : "Cancel"}
          </ConfirmForm>
          <ConfirmForm
            action={deleteContract.bind(null, contract.id)}
            confirmText="Delete this contract and all its documents? This cannot be undone."
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-danger hover:bg-danger/10"
          >
            <Trash2 size={16} />
            Delete
          </ConfirmForm>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <Detail label="Contract / policy number" value={contract.contractNumber ?? "—"} />
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
                ? `${formatCurrency(contract.cost, contract.currency)}${
                    contract.billingFrequency
                      ? ` / ${BILLING_LABELS[contract.billingFrequency]?.toLowerCase()}`
                      : ""
                  }`
                : "—"
            }
          />
        </dl>
      </div>

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

      {contract.category === "RENTAL" && contract.rentalAgreement && (
        <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
          <div className="mb-3 flex items-center gap-2">
            <Home size={18} className="text-foreground/50" />
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

      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <h2 className="mb-3 font-medium">Documents</h2>
        <DocumentList documents={contract.documents} dateFormat={dateFormat} />
        <div className="mt-4 border-t border-border pt-4">
          <DocumentUploadForm action={boundUpload} />
        </div>
      </div>

      <p className="text-xs text-foreground/40">
        Added by {contract.createdBy.name} on {formatDate(contract.createdAt, dateFormat)}
      </p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-foreground/50">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}
