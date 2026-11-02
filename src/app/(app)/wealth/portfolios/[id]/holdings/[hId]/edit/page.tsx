import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { prisma } from "@/lib/prisma";
import { updateHolding } from "@/lib/actions/wealth";
import { HoldingForm } from "@/components/HoldingForm";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";
import { Card } from "@/components/ui/Card";
import { PageShell } from "@/components/ui/PageShell";

export const metadata: Metadata = { title: "Edit Holding" };

export default async function EditHoldingPage({
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

  const action = updateHolding.bind(null, portfolioId, holdingId);

  return (
    <PageShell width="form">
      <div>
        <BackLink href={`/wealth/portfolios/${portfolioId}/holdings/${holdingId}`} label={holding.ticker} />
        <h1 className="mt-1 text-2xl font-medium">Edit holding</h1>
      </div>
      <Card>
        <HoldingForm cancelHref={`/wealth/portfolios/${portfolioId}/holdings/${holdingId}`} action={action} holding={holding} />
      </Card>
    </PageShell>
  );
}
