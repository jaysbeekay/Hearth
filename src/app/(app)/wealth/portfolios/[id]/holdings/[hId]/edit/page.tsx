import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { prisma } from "@/lib/prisma";
import { updateHolding } from "@/lib/actions/wealth";
import { HoldingForm } from "@/components/HoldingForm";

export const metadata: Metadata = { title: "Edit Holding" };

export default async function EditHoldingPage({
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

  const action = updateHolding.bind(null, portfolioId, holdingId);

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <Link href={`/wealth/portfolios/${portfolioId}/holdings/${holdingId}`} className="text-sm text-foreground/60 hover:text-foreground">
          ← {holding.ticker}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Edit holding</h1>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <HoldingForm action={action} holding={holding} />
      </div>
    </div>
  );
}
