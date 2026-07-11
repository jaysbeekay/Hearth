import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Trash2, Plus, FileText, Link2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import {
  deleteRentalAgreement,
  setPropertyRented,
  deleteRentalStatement,
  addRentalStatementDocument,
  linkRentalAgreementContract,
} from "@/lib/actions/home";
import { ConfirmForm } from "@/components/ConfirmForm";
import { DocumentUploadForm } from "@/components/DocumentUploadForm";
import { RentalStatementDocumentList } from "@/components/RentalStatementDocumentList";
import { SelectWrapper, selectClass } from "@/components/SelectWrapper";
import { formatCurrency, formatDate } from "@/lib/utils";
import { getUserPreferences } from "@/lib/userPreferences";

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
  const [property, rentalContracts, { dateFormat }] = await Promise.all([
    prisma.property.findUnique({
      where: { id },
      include: {
        rentalAgreements: { include: { contract: true }, orderBy: { createdAt: "desc" } },
        rentalStatements: {
          include: { documents: { orderBy: { uploadedAt: "desc" } } },
          orderBy: { periodStart: "desc" },
        },
      },
    }),
    prisma.contract.findMany({
      where: { category: "RENTAL" },
      select: { id: true, title: true, provider: true },
      orderBy: { title: "asc" },
    }),
    getUserPreferences(),
  ]);
  if (!property) notFound();

  const agreements = property.rentalAgreements;
  const statements = property.rentalStatements;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link
          href={`/home/${property.id}`}
          className="text-sm text-foreground/60 hover:text-foreground"
        >
          ← Back to property
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-foreground/60">{property.label}</p>
          <h1 className="text-2xl font-semibold">Rental tracking</h1>
        </div>
        {property.isRented && (
          <ConfirmForm
            action={setPropertyRented.bind(null, property.id, false)}
            confirmText="Disable rental tracking for this property? Agreements and statements will be kept."
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground/70 hover:bg-black/5 dark:hover:bg-white/5"
          >
            Disable rental tracking
          </ConfirmForm>
        )}
      </div>

      {!property.isRented && agreements.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <p className="text-sm text-foreground/60">
            This property isn&apos;t set up for rental tracking yet.
          </p>
          <Link
            href={`/home/${property.id}/rental/agreements/new`}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
          >
            <Plus size={16} />
            Add first rental agreement
          </Link>
        </div>
      )}

      {/* Rental agreements */}
      {(property.isRented || agreements.length > 0) && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Rental agreements</h2>
            <Link
              href={`/home/${property.id}/rental/agreements/new`}
              className="flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
            >
              <Plus size={16} />
              New agreement
            </Link>
          </div>

          {agreements.length === 0 ? (
            <p className="text-sm text-foreground/60">No rental agreements recorded yet.</p>
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
                        {formatCurrency(ag.weeklyRent, ag.currency)}/wk
                        {ag.managementFeePercent != null && (
                          <span className="ml-2 text-sm font-normal text-foreground/60">
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
                        <p className="text-sm text-foreground/70">{ag.tenantName}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/home/${property.id}/rental/agreements/${ag.id}/edit`}
                        className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
                      >
                        <Pencil size={16} />
                        Edit
                      </Link>
                      <ConfirmForm
                        action={deleteRentalAgreement.bind(null, property.id, ag.id)}
                        confirmText="Delete this rental agreement? Statements are not affected."
                        className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-danger hover:bg-danger/10"
                      >
                        <Trash2 size={16} />
                        Delete
                      </ConfirmForm>
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
                    <Detail label="Added" value={formatDate(ag.createdAt, dateFormat)} />
                  </dl>
                  {ag.notes && (
                    <p className="mt-3 text-sm text-foreground/70">{ag.notes}</p>
                  )}

                  <div className="mt-4 border-t border-border pt-4">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                      <Link2 size={14} className="text-foreground/50" />
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
                          <p className="text-xs text-foreground/50">
                            {ag.contract.provider}
                            {ag.contract.cost != null &&
                              ` · ${formatCurrency(ag.contract.cost, ag.contract.currency)}`}
                          </p>
                        </div>
                        <form action={linkRentalAgreementContract.bind(null, property.id, ag.id)}>
                          <input type="hidden" name="contractId" value="" />
                          <button
                            type="submit"
                            className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5"
                          >
                            Unlink
                          </button>
                        </form>
                      </div>
                    ) : rentalContracts.length === 0 ? (
                      <p className="text-sm text-foreground/60">
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
                              <option key={c.id} value={c.id}>
                                {c.title} ({c.provider})
                              </option>
                            ))}
                          </select>
                        </SelectWrapper>
                        <button
                          type="submit"
                          className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
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
            <Link
              href={`/home/${property.id}/rental/statements/new`}
              className="flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
            >
              <Plus size={16} />
              Add statement
            </Link>
          </div>

          {statements.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-foreground/60">
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
                          <p className="text-sm text-foreground/60">
                            Statement date: {formatDate(stmt.statementDate, dateFormat)}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/home/${property.id}/rental/statements/${stmt.id}/edit`}
                          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
                        >
                          <Pencil size={16} />
                          Edit
                        </Link>
                        <ConfirmForm
                          action={deleteRentalStatement.bind(null, property.id, stmt.id)}
                          confirmText="Delete this statement and its documents?"
                          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-danger hover:bg-danger/10"
                        >
                          <Trash2 size={16} />
                          Delete
                        </ConfirmForm>
                      </div>
                    </div>

                    {/* Actuals vs expected */}
                    <div className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                      <AmountCell
                        label="Gross rent"
                        actual={stmt.grossRent}
                        expected={expected?.expectedGross ?? null}
                        currency={currency}
                      />
                      <AmountCell
                        label="Management fee"
                        actual={stmt.managementFee}
                        expected={expected?.expectedFee ?? null}
                        currency={currency}
                      />
                      <AmountCell
                        label="Other deductions"
                        actual={stmt.otherDeductions}
                        expected={null}
                        currency={currency}
                      />
                      <AmountCell
                        label="Net to owner"
                        actual={stmt.netAmount}
                        expected={expected?.expectedNet ?? null}
                        currency={currency}
                        highlight
                      />
                    </div>

                    {stmt.notes && (
                      <p className="mt-3 text-sm text-foreground/70">{stmt.notes}</p>
                    )}

                    <div className="mt-4 border-t border-border pt-4">
                      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                        <FileText size={14} className="text-foreground/50" />
                        Documents
                      </div>
                      <RentalStatementDocumentList
                        documents={stmt.documents}
                        dateFormat={dateFormat}
                      />
                      <div className="mt-3">
                        <DocumentUploadForm
                          action={addRentalStatementDocument.bind(null, stmt.id)}
                        />
                      </div>
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

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-foreground/50">{label}</dt>
      <dd className="text-sm font-medium">{value ?? "—"}</dd>
    </div>
  );
}

function AmountCell({
  label,
  actual,
  expected,
  currency,
  highlight,
}: {
  label: string;
  actual: number | null;
  expected: number | null;
  currency: string;
  highlight?: boolean;
}) {
  const diff = actual != null && expected != null ? actual - expected : null;
  const diffOk = diff != null && Math.abs(diff) < 0.01;
  const diffBad = diff != null && !diffOk;

  return (
    <div>
      <dt className="text-xs text-foreground/50">{label}</dt>
      <dd className={`text-sm font-medium ${highlight ? "text-base" : ""}`}>
        {actual != null ? formatCurrency(actual, currency) : "—"}
      </dd>
      {expected != null && actual != null && (
        <dd
          className={`mt-0.5 text-xs ${
            diffOk ? "text-success" : diffBad ? "text-danger" : "text-foreground/50"
          }`}
        >
          {diffOk
            ? "✓ matches"
            : diff != null
              ? `${diff > 0 ? "+" : ""}${formatCurrency(diff, currency)} vs expected`
              : ""}
        </dd>
      )}
      {expected != null && actual == null && (
        <dd className="mt-0.5 text-xs text-foreground/40">
          expected {formatCurrency(expected, currency)}
        </dd>
      )}
    </div>
  );
}
