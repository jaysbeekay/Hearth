import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { prisma } from "@/lib/prisma";
import { updateTrade } from "@/lib/actions/wealth";
import { TradeForm } from "@/components/TradeForm";
import { isCryptoHolding } from "@/lib/priceSource";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";

export const metadata: Metadata = { title: "Edit Trade" };

export default async function EditTradePage({
  params,
}: {
  params: Promise<{ id: string; hId: string; tradeId: string }>;
}) {
  await requireModuleEnabled("WEALTH");
  const { id: portfolioId, hId: holdingId, tradeId } = await params;
  redirectIfReadOnly(await auth(), `/wealth/portfolios/${portfolioId}/holdings/${holdingId}`);

  const trade = await prisma.trade.findUnique({
    where: { id: tradeId },
    include: { holding: { include: { portfolio: true } } },
  });
  if (
    !trade ||
    trade.holdingId !== holdingId ||
    trade.holding.portfolioId !== portfolioId
  ) {
    notFound();
  }

  const action = updateTrade.bind(null, holdingId, tradeId);

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <BackLink href={`/wealth/portfolios/${portfolioId}/holdings/${holdingId}`} label={trade.holding.ticker} />
        <h1 className="mt-1 text-2xl font-semibold">Edit trade</h1>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <TradeForm action={action} trade={trade} ticker={trade.holding.ticker} lookUpMarketPrice={!isCryptoHolding(trade.holding)} defaultCurrency={trade.holding.portfolio.currency} />
      </div>
    </div>
  );
}
