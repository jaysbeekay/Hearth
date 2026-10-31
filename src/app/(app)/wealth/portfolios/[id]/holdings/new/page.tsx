import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { prisma } from "@/lib/prisma";
import { createHolding } from "@/lib/actions/wealth";
import { HoldingForm } from "@/components/HoldingForm";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";
import { Card, PageShell } from "@/components/ui";

export const metadata: Metadata = { title: "Add Holding" };

export default async function NewHoldingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleEnabled("WEALTH");
  const { id } = await params;
  redirectIfReadOnly(await auth(), `/wealth/portfolios/${id}`);

  const portfolio = await prisma.portfolio.findUnique({ where: { id } });
  if (!portfolio) notFound();

  const action = createHolding.bind(null, id);

  return (
    <PageShell width="form">
      <div>
        <BackLink href={`/wealth/portfolios/${id}`} label={portfolio.name} />
        <h1 className="mt-1 text-2xl font-medium">Add holding</h1>
      </div>
      <Card>
        <HoldingForm action={action} portfolioId={id} />
      </Card>
    </PageShell>
  );
}
