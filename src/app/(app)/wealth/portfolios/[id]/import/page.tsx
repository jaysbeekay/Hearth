import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { prisma } from "@/lib/prisma";
import { WealthImportClient } from "@/components/WealthImportClient";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";
import { Card } from "@/components/ui/Card";
import { PageShell } from "@/components/ui/PageShell";

export const metadata: Metadata = { title: "Import Trades" };

export default async function ImportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleEnabled("WEALTH");
  const { id } = await params;
  redirectIfReadOnly(await auth(), `/wealth/portfolios/${id}`);

  const portfolio = await prisma.portfolio.findUnique({ where: { id } });
  if (!portfolio) notFound();

  return (
    <PageShell width="detail">
      <div>
        <BackLink href={`/wealth/portfolios/${id}`} label={portfolio.name} />
        <h1 className="mt-1 text-2xl font-medium">Import trades</h1>
      </div>
      <Card>
        <WealthImportClient portfolioId={id} />
      </Card>
    </PageShell>
  );
}
