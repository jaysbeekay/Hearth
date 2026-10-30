import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { renewContract } from "@/lib/actions/contracts";
import { ContractRenewForm } from "@/components/ContractRenewForm";
import { BackLink } from "@/components/BackLink";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { getUserPreferences } from "@/lib/userPreferences";
import { billingFrequencyText, formatTermCost, nextTermDates } from "@/lib/contractTerms";
import { formatDate } from "@/lib/utils";

// #353 — Renew: adds the Contract's next Term and keeps the current one as
// history. Reached from the detail page's header, its Due banner and Needs
// attention (both the Due row and the "Set the new end date" Housekeeping
// row of an auto-renewing Contract past its end date).
export default async function RenewContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirectIfReadOnly(await auth(), `/contracts/${id}`);
  const [contract, { dateFormat, region }] = await Promise.all([
    prisma.contract.findUnique({ where: { id } }),
    getUserPreferences(),
  ]);
  if (!contract || contract.deletedAt) notFound();
  // A Cancelled Contract is marked active first (from its detail page).
  if (contract.status === "CANCELLED") redirect(`/contracts/${id}`);

  const next = nextTermDates(contract);
  const frequency = billingFrequencyText(contract.billingFrequency);
  const currentCost = contract.cost != null ? formatTermCost(contract, region) : "no cost";
  const currentTerm =
    contract.startDate || contract.endDate
      ? `${formatDate(contract.startDate, dateFormat)} – ${formatDate(contract.endDate, dateFormat)}`
      : "no dates";

  return (
    <div className="max-w-3xl space-y-6">
      <BackLink href={`/contracts/${contract.id}`} label={contract.title} />
      <div>
        <h1 className="text-2xl font-semibold">Renew contract</h1>
        <p className="text-sm text-muted">{contract.title}</p>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 md:p-6 space-y-4">
        <p className="text-sm text-muted">
          Current term: {currentTerm}, {currentCost}. It&apos;s kept under Previous terms once you renew.
        </p>
        <ContractRenewForm
          action={renewContract.bind(null, contract.id)}
          defaults={{
            startDate: next.startDate ?? "",
            endDate: next.endDate ?? "",
            cost: contract.cost != null ? String(contract.cost) : "",
          }}
          baseUpdatedAt={contract.updatedAt.toISOString()}
          costHint={frequency ? `${contract.currency}, billed ${frequency}` : contract.currency}
          cancelHref={`/contracts/${contract.id}`}
        />
      </div>
    </div>
  );
}
