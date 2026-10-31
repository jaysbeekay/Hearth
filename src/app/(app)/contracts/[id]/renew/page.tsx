import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { renewContract } from "@/lib/actions/contracts";
import { renewalRefusal, termDocumentCandidates } from "@/lib/commands/contracts";
import { ContractRenewForm } from "@/components/ContractRenewForm";
import { BackLink } from "@/components/BackLink";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { getUserPreferences } from "@/lib/userPreferences";
import { getDueContext } from "@/lib/appSettings";
import { billingFrequencyText, formatTermCost, nextTermDates, pickTermDocument } from "@/lib/contractTerms";
import { formatDate } from "@/lib/utils";
import { Card, PageShell } from "@/components/ui";

// #353 — Renew: adds the Contract's next Term and keeps the current one as
// history. Reached from the detail page's header, its Due banner and Needs
// attention (both the Due row and the "Set the new end date" Housekeeping
// row of an auto-renewing Contract past its end date).
export default async function RenewContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirectIfReadOnly(await auth(), `/contracts/${id}`);
  const [contract, { dateFormat, region }, { today }, candidates] = await Promise.all([
    prisma.contract.findUnique({ where: { id } }),
    getUserPreferences(),
    getDueContext(),
    termDocumentCandidates(id),
  ]);
  if (!contract || contract.deletedAt) notFound();
  // Cancelled, fixed-term or no end date: nothing to renew from here (the
  // command refuses these too).
  if (renewalRefusal(contract)) redirect(`/contracts/${id}`);

  // An auto-renewing Contract carried on by itself, so its next Term is the
  // one running now, not one that has already ended.
  const next = nextTermDates(contract, contract.renewalType === "AUTO_RENEW" ? { rollForwardTo: today } : {});
  const frequency = billingFrequencyText(contract.billingFrequency);
  const currentCost = contract.cost != null ? formatTermCost(contract, region) : "no cost";
  const currentTerm = `${formatDate(contract.startDate, dateFormat)} – ${formatDate(contract.endDate, dateFormat)}`;

  return (
    <PageShell width="form">
      <BackLink href={`/contracts/${contract.id}`} label={contract.title} />
      <div>
        <h1 className="text-2xl font-medium">Renew contract</h1>
        <p className="text-sm text-muted">{contract.title}</p>
      </div>
      <Card className="space-y-4">
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
          today={today}
          baseUpdatedAt={contract.updatedAt.toISOString()}
          costHint={frequency ? `${contract.currency}, billed ${frequency}` : contract.currency}
          cancelHref={`/contracts/${contract.id}`}
          // Only worth asking when there's a choice to make.
          termDocuments={
            candidates.length >= 2
              ? {
                  options: candidates.map((doc) => ({ id: doc.id, filename: doc.filename })),
                  defaultId: pickTermDocument(candidates) ?? "",
                }
              : undefined
          }
        />
      </Card>
    </PageShell>
  );
}
