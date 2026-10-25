import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { prisma } from "@/lib/prisma";
import { createTrade } from "@/lib/actions/wealth";
import { TradeForm } from "@/components/TradeForm";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";

export const metadata: Metadata = { title: "Add Trade" };

export default async function NewTradePage({
  params,
}: {
  params: Promise<{ id: string; hId: string }>;
}) {
  await requireModuleEnabled("WEALTH");
  const { id: portfolioId, hId: holdingId } = await params;
  redirectIfReadOnly(await auth(), `/wealth/portfolios/${portfolioId}/holdings/${holdingId}`);

  const holding = await prisma.holding.findUnique({
    where: { id: holdingId },
    include: { portfolio: true },
  });
  if (!holding || holding.portfolioId !== portfolioId) {
    notFound();
  }

  const action = createTrade.bind(null, holdingId);

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <BackLink href={`/wealth/portfolios/${portfolioId}/holdings/${holdingId}`} label={holding.ticker} />
        <h1 className="mt-1 text-2xl font-semibold">Add trade</h1>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <TradeForm
          action={action}
          holdingId={holdingId}
          ticker={holding.ticker}
          defaultCurrency={holding.portfolio.currency}
        />
      </div>
    </div>
  );
}
