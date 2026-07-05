import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { prisma } from "@/lib/prisma";
import { createTrade } from "@/lib/actions/wealth";
import { TradeForm } from "@/components/TradeForm";

export const metadata: Metadata = { title: "Add Trade" };

export default async function NewTradePage({
  params,
}: {
  params: Promise<{ id: string; hId: string }>;
}) {
  await requireModuleEnabled("WEALTH");
  const session = await auth();
  const { id: portfolioId, hId: holdingId } = await params;

  const holding = await prisma.holding.findUnique({
    where: { id: holdingId },
    include: { portfolio: true },
  });
  if (!holding || holding.portfolio.createdById !== session!.user.id || holding.portfolioId !== portfolioId) {
    notFound();
  }

  const action = createTrade.bind(null, holdingId);

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <Link href={`/wealth/portfolios/${portfolioId}/holdings/${holdingId}`} className="text-sm text-foreground/60 hover:text-foreground">
          ← {holding.ticker}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Add trade</h1>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <TradeForm action={action} defaultCurrency={holding.portfolio.currency} />
      </div>
    </div>
  );
}
