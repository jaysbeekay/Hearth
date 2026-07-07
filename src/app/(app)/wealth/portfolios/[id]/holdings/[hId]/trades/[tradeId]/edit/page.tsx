import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { prisma } from "@/lib/prisma";
import { updateTrade } from "@/lib/actions/wealth";
import { TradeForm } from "@/components/TradeForm";

export const metadata: Metadata = { title: "Edit Trade" };

export default async function EditTradePage({
  params,
}: {
  params: Promise<{ id: string; hId: string; tradeId: string }>;
}) {
  await requireModuleEnabled("WEALTH");
  const session = await auth();
  const { id: portfolioId, hId: holdingId, tradeId } = await params;

  const trade = await prisma.trade.findUnique({
    where: { id: tradeId },
    include: { holding: { include: { portfolio: true } } },
  });
  if (
    !trade ||
    trade.holdingId !== holdingId ||
    trade.holding.portfolioId !== portfolioId ||
    trade.holding.portfolio.createdById !== session!.user.id
  ) {
    notFound();
  }

  const action = updateTrade.bind(null, holdingId, tradeId);

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <Link href={`/wealth/portfolios/${portfolioId}/holdings/${holdingId}`} className="text-sm text-foreground/60 hover:text-foreground">
          ← {trade.holding.ticker}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Edit trade</h1>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <TradeForm action={action} trade={trade} ticker={trade.holding.ticker} defaultCurrency={trade.holding.portfolio.currency} />
      </div>
    </div>
  );
}
