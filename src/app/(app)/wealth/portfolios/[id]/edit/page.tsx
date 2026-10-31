import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { prisma } from "@/lib/prisma";
import { updatePortfolio } from "@/lib/actions/wealth";
import { PortfolioForm } from "@/components/PortfolioForm";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";
import { Card } from "@/components/ui/Card";
import { PageShell } from "@/components/ui/PageShell";

export const metadata: Metadata = { title: "Edit Portfolio" };

export default async function EditPortfolioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleEnabled("WEALTH");
  const { id } = await params;
  redirectIfReadOnly(await auth(), `/wealth/portfolios/${id}`);

  const portfolio = await prisma.portfolio.findUnique({ where: { id } });
  if (!portfolio) notFound();

  const action = updatePortfolio.bind(null, id);

  return (
    <PageShell width="form">
      <div>
        <BackLink href={`/wealth/portfolios/${id}`} label={portfolio.name} />
        <h1 className="mt-1 text-2xl font-medium">Edit portfolio</h1>
      </div>
      <Card>
        <PortfolioForm action={action} portfolio={portfolio} />
      </Card>
    </PageShell>
  );
}
