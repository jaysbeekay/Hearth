import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { prisma } from "@/lib/prisma";
import { WealthImportClient } from "@/components/WealthImportClient";

export const metadata: Metadata = { title: "Import Trades" };

export default async function ImportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModuleEnabled("WEALTH");
  const session = await auth();
  const { id } = await params;

  const portfolio = await prisma.portfolio.findUnique({ where: { id } });
  if (!portfolio || portfolio.createdById !== session!.user.id) notFound();

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href={`/wealth/portfolios/${id}`} className="text-sm text-foreground/60 hover:text-foreground">← Back to {portfolio.name}</Link>
        <h1 className="mt-1 text-2xl font-semibold">Import trades</h1>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <WealthImportClient portfolioId={id} />
      </div>
    </div>
  );
}
