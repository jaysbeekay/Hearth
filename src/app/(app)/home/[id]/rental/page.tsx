import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Trash2, Plus, FileText, Link2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { addDocumentAction } from "@/lib/actions/documents";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import {
  deleteRentalAgreement,
  restoreRentalAgreement,
  setPropertyRented,
  deleteRentalStatement,
  restoreRentalStatement,
  linkRentalAgreementContract,
} from "@/lib/actions/home";
import { ConfirmForm } from "@/components/ConfirmForm";
import { DetailField as Detail } from "@/components/DetailField";
import { DocumentUploadForm } from "@/components/DocumentUploadForm";
import { RentalStatementDocumentList } from "@/components/RentalStatementDocumentList";
import { SelectWrapper, selectClass } from "@/components/SelectWrapper";
import { formatCurrency, formatDate, formatTimestamp } from "@/lib/utils";
import { getUserPreferences } from "@/lib/userPreferences";
import { auth } from "@/lib/auth";
import { canWrite as sessionCanWrite } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";

function reconcile(
  periodStart: Date | null,
  periodEnd: Date | null,
  weeklyRent: number,
  managementFeePercent: number | null,
) {
  if (!periodStart || !periodEnd) return null;
  const days = Math.round(
    (periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (days <= 0) return null;
  const expectedGross = (weeklyRent * days) / 7;
  const expectedFee =
    managementFeePercent != null ? (expectedGross * managementFeePercent) / 100 : null;
  const expectedNet = expectedFee != null ? expectedGross - expectedFee : null;
  return { expectedGross, expectedFee, expectedNet, days };
}

function findActiveAgreement(
  agreements: Array<{
    id: string;
    weeklyRent: number;
    managementFeePercent: number | null;
    leaseStart: Date | null;
    leaseEnd: Date | null;
    tenantName: string | null;
    currency: string;
    notes: string | null;
    createdAt: Date;
  }>,
  periodStart: Date | null,
  periodEnd: Date | null,
) {
  if (!agreements.length) return null;
  if (!periodStart && !periodEnd) return agreements[0];
  const refDate = periodStart ?? periodEnd!;
  return (
    agreements.find(
      (a) =>
        (!a.leaseStart || a.leaseStart <= refDate) &&
        (!a.leaseEnd || a.leaseEnd >= refDate),
    ) ?? agreements[0]
  );
}

export default async function RentalOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleEnabled("HOME");

  const { id } = await params;
  const canWrite = sessionCanWrite(await auth());
  const [property, rentalContracts, { dateFormat, displayTimeZone, region }] = await Promise.all([
    prisma.property.findUnique({
      where: { id },
      include: {
        rentalAgreements: { where: { deletedAt: null }, include: { contract: true }, orderBy: { createdAt: "desc" } },
        rentalStatements: {
          where: { deletedAt: null },
          include: { documents: { where: { deletedAt: null }, orderBy: { uploadedAt: "desc" } } },
          orderBy: { periodStart: "desc" },
        },
      },
    }),
    prisma.contract.findMany({
      // A Contract links to one Tenancy at most, and one in Trash can't be
      // linked (linkTenancyContractCommand refuses both). One still held by
      // a Tenancy in Trash is listed but disabled, so it's clear why it
      // can't be picked (#427).
      where: {
        category: "RENTAL",
        deletedAt: null,
        OR: [{ rentalAgreement: null }, { rentalAgreement: { deletedAt: { not: null } } }],
      },
      select: { id: true, title: true, provider: true, rentalAgreement: { select: { id: true } } },
      orderBy: { title: "asc" },
    }),
    getUserPreferences(),
  ]);
  if (!property || property.deletedAt) notFound();

  const agreements = property.rentalAgreements;
  const statements = property.rentalStatements;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <BackLink href={`/home/${property.id}`} label={property.label} />
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted">{property.label}</p>
          <h1 className="text-2xl font-semibold">Tenancy</h1>
        </div>
        {canWrite && property.isRented && (
            <>
              <ConfirmForm
                action={setPropertyRented.bind(null, property.id, false)}
                confirmText="Stop tracking a tenancy for this property? Past tenancies and statements will be kept."
                actionLabel="Stop tracking tenancy"
                className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted hover:bg-hover"
              >
                Stop tracking tenancy
              </ConfirmForm>
            </>
        )}
      </div>

      {!property.isRented && agreements.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted">
            This property has no tenancy yet.
          </p>
          {canWrite && (
            <Link
              href={`/home/${property.id}/rental/agreements/new`}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
            >
              <Plus size={16} />
              Add tenancy
            </Link>
          )}
        </div>
      )}

      {/* Rental agreements */}
      {(property.isRented || agreements.length > 0) && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Tenancies</h2>
            {canWrite && (
              <Link
                href={`/home/${property.id}/rental/agreements/new`}
                className="flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
              >
                <Plus size={16} />
                New tenancy
              </Link>
            )}
          </div>

          {agreements.length === 0 ? (
            <p className="text-sm text-muted">No tenancies recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {agreements.map((ag, i) => (
                <div
                  key={ag.id}
                  className="rounded-xl border border-border bg-surface p-4 md:p-6"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">
                        {formatCurrency(ag.weeklyRent, ag.currency, undefined, region)}/wk
                        {ag.managementFeePercent != null && (
                          <span className="ml-2 text-sm font-normal text-muted">
                            · {ag.managementFeePercent}% management fee
                          </span>
                        )}
                        {i === 0 && (
                          <span className="ml-2 rounded-full bg-success/10 px-2 py-0.5 text-xs font-normal text-success">
                            Current
                          </span>
                        )}
                      </p>
                      {ag.tenantName && (
                        <p className="text-sm text-muted">{ag.tenantName}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {canWrite && (
                        <>
                          <Link
                            href={`/home/${property.id}/rental/agreements/${ag.id}/edit`}
                            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-hover"
                          >
                            <Pencil size={16} />
                            Edit
                          </Link>
                          <ConfirmForm
                            action={deleteRentalAgreement.bind(null, property.id, ag.id)}
                            undo={{ action: restoreRentalAgreement.bind(null, ag.id) }}
                            offline={{
                              entity: "rentalAgreement",
                              entityId: ag.id,
                              parentId: property.id,
                              label: `Delete tenancy: ${ag.tenantName ?? property.label}`,
                            }}
                            confirmText="Move this tenancy to Trash? Statements are not affected, and you can restore it within 30 days from Settings → Trash."
                            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-danger hover:bg-danger/10"
                          >
                            <Trash2 size={16} />
                            Delete
                          </ConfirmForm>
                        </>
                      )}
                    </div>
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
                    <Detail
                      label="Lease period"
                      value={
                        ag.leaseStart || ag.leaseEnd
                          ? `${formatDate(ag.leaseStart, dateFormat)} – ${formatDate(ag.leaseEnd, dateFormat)}`
                          : "—"
                      }
                    />
                    <Detail label="Added" value={formatTimestamp(ag.createdAt, dateFormat, displayTimeZone)} />
                  </dl>
                  {ag.notes && (
                    <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">{ag.notes}</p>
                  )}

                  <div className="mt-4 border-t border-border pt-4">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                      <Link2 size={14} className="text-muted" />
                      Linked contract
                    </div>
                    {ag.contract ? (
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <Link
                            href={`/contracts/${ag.contract.id}`}
                            className="text-sm font-medium text-accent hover:underline"
                          >
                            {ag.contract.title}
                          </Link>
                          <p className="text-xs text-muted">
                            {ag.contract.provider}
                            {ag.contract.cost != null &&
                              ` · ${formatCurrency(ag.contract.cost, ag.contract.currency, undefined, region)}`}
                          </p>
                        </div>
                        {canWrite && (
                          <form action={linkRentalAgreementContract.bind(null, property.id, ag.id)}>
                            <input type="hidden" name="contractId" value="" />
                            <button
                              type="submit"
                              className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-hover"
                            >
                              Unlink
                            </button>
                          </form>
                        )}
                      </div>
                    ) : !canWrite ? (
                      <p className="text-sm text-muted">Not linked.</p>
                    ) : rentalContracts.length === 0 ? (
                      <p className="text-sm text-muted">
                        No Rental-category contracts to link yet.
                      </p>
                    ) : (
                      <form
                        action={linkRentalAgreementContract.bind(null, property.id, ag.id)}
                        className="flex items-center gap-2"
                      >
                        <SelectWrapper>
                          <select name="contractId" defaultValue="" className={selectClass}>
                            <option value="">Not linked</option>
                            {rentalContracts.map((c) => (
                              <option key={c.id} value={c.id} disabled={c.rentalAgreement !== null}>
                                {`${c.title} (${c.provider})${c.rentalAgreement !== null ? " (linked to a tenancy in Trash)" : ""}`}
                              </option>
                            ))}
                          </select>
                        </SelectWrapper>
                        <button
                          type="submit"
                          className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-hover"
                        >
                          Link
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Rental statements */}
      {(property.isRented || agreements.length > 0) && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Rental statements</h2>
            {canWrite && (
              <Link
                href={`/home/${property.id}/rental/statements/new`}
                className="flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
              >
                <Plus size={16} />
                Add statement
              </Link>
            )}
          </div>

          {statements.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted">
              No statements yet. Upload your first rental statement to start reconciling.
            </p>
          ) : (
            <div className="space-y-3">
              {statements.map((stmt) => {
                const ag = findActiveAgreement(
                  agreements,
                  stmt.periodStart,
                  stmt.periodEnd,
                );
                const expected = ag
                  ? reconcile(
                      stmt.periodStart,
                      stmt.periodEnd,
                      ag.weeklyRent,
                      ag.managementFeePercent,
                    )
                  : null;
                const currency = stmt.currency;

                return (
                  <div
                    key={stmt.id}
                    className="rounded-xl border border-border bg-surface p-4 md:p-6"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="font-medium">
                          {stmt.periodStart && stmt.periodEnd
                            ? `${formatDate(stmt.periodStart, dateFormat)} – ${formatDate(stmt.periodEnd, dateFormat)}`
                            : "Period not set"}
                        </p>
                        {stmt.statementDate && (
                          <p className="text-sm text-muted">
                            Statement date: {formatDate(stmt.statementDate, dateFormat)}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {canWrite && (
                          <>
                            <Link
                              href={`/home/${property.id}/rental/statements/${stmt.id}/edit`}
                              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-hover"
                            >
                              <Pencil size={16} />
                              Edit
                            </Link>
                            <ConfirmForm
                              action={deleteRentalStatement.bind(null, property.id, stmt.id)}
                              undo={{ action: restoreRentalStatement.bind(null, stmt.id) }}
                              offline={{
                                entity: "rentalStatement",
                                entityId: stmt.id,
                                parentId: property.id,
                                label: `Delete statement: ${formatDate(stmt.statementDate ?? stmt.periodEnd, dateFormat)}`,
                              }}
                              confirmText="Move this statement to Trash? Its documents are kept, and you can restore it within 30 days from Settings → Trash."
                              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-danger hover:bg-danger/10"
                            >
                              <Trash2 size={16} />
                              Delete
                            </ConfirmForm>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Actuals vs expected */}
                    <div className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                      <AmountCell
                        label="Gross rent"
                        actual={stmt.grossRent}
                        expected={expected?.expectedGross ?? null}
                        currency={currency}
                        region={region}
                      />
                      <AmountCell
                        label="Management fee"
                        actual={stmt.managementFee}
                        expected={expected?.expectedFee ?? null}
                        currency={currency}
                        region={region}
                      />
                      <AmountCell
                        label="Other deductions"
                        actual={stmt.otherDeductions}
                        expected={null}
                        currency={currency}
                        region={region}
                      />
                      <AmountCell
                        label="Net to owner"
                        actual={stmt.netAmount}
                        expected={expected?.expectedNet ?? null}
                        currency={currency}
                        highlight
                        region={region}
                      />
                    </div>

                    {stmt.notes && (
                      <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">{stmt.notes}</p>
                    )}

                    <div className="mt-4 border-t border-border pt-4">
                      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                        <FileText size={14} className="text-muted" />
                        Documents
                      </div>
                      <RentalStatementDocumentList
                        documents={stmt.documents}
                        dateFormat={dateFormat}
                      />
                      {canWrite && (
                        <div className="mt-3">
                          <DocumentUploadForm
                            action={addDocumentAction.bind(null, "RENTAL_STATEMENT", stmt.id)}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AmountCell({
  label,
  actual,
  expected,
  currency,
  highlight,
  region,
}: {
  label: string;
  actual: number | null;
  expected: number | null;
  currency: string;
  highlight?: boolean;
  region?: string;
}) {
  const diff = actual != null && expected != null ? actual - expected : null;
  const diffOk = diff != null && Math.abs(diff) < 0.01;
  const diffBad = diff != null && !diffOk;

  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`text-sm font-medium break-words ${highlight ? "text-base" : ""}`}>
        {actual != null ? formatCurrency(actual, currency, undefined, region) : "—"}
      </dd>
      {expected != null && actual != null && (
        <dd
          className={`mt-0.5 text-xs ${
            diffOk ? "text-success" : diffBad ? "text-danger" : "text-muted"
          }`}
        >
          {diffOk
            ? "✓ matches"
            : diff != null
              ? `${diff > 0 ? "+" : ""}${formatCurrency(diff, currency, undefined, region)} vs expected`
              : ""}
        </dd>
      )}
      {expected != null && actual == null && (
        <dd className="mt-0.5 text-xs text-muted">
          expected {formatCurrency(expected, currency, undefined, region)}
        </dd>
      )}
    </div>
  );
}
