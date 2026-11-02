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
import { Card } from "@/components/ui/Card";
import { PageShell } from "@/components/ui/PageShell";

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
    trade.deletedAt ||
    trade.holdingId !== holdingId ||
    trade.holding.portfolioId !== portfolioId
  ) {
    notFound();
  }

  const action = updateTrade.bind(null, holdingId, tradeId);

  return (
    <PageShell width="form">
      <div>
        <BackLink href={`/wealth/portfolios/${portfolioId}/holdings/${holdingId}`} label={trade.holding.ticker} />
        <h1 className="mt-1 text-2xl font-medium">Edit trade</h1>
      </div>
      <Card>
        <TradeForm cancelHref={`/wealth/portfolios/${portfolioId}/holdings/${holdingId}`} action={action} trade={trade} ticker={trade.holding.ticker} lookUpMarketPrice={!isCryptoHolding(trade.holding)} defaultCurrency={trade.holding.portfolio.currency} />
      </Card>
    </PageShell>
  );
}
