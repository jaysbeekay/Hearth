import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { ConfirmForm } from "@/components/ConfirmForm";
import { deletePortfolio } from "@/lib/actions/wealth";
import { auth } from "@/lib/auth";
import { canWrite as sessionCanWrite } from "@/lib/readOnly";
import { BackLink } from "@/components/BackLink";
import { Card } from "@/components/ui/Card";
import { buttonClass, emptyStateClass } from "@/lib/ui";

export const metadata: Metadata = { title: "Portfolios" };

export default async function PortfoliosPage() {
  await requireModuleEnabled("WEALTH");
  const canWrite = sessionCanWrite(await auth());

  const portfolios = await prisma.portfolio.findMany({
    include: { holdings: { include: { _count: { select: { trades: { where: { deletedAt: null } } } } } } },
    orderBy: { name: "asc" },
  });

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <BackLink href="/wealth" label="Wealth" />
          <h1 className="mt-1 text-2xl font-medium">Portfolios</h1>
        </div>
        {canWrite && (
          <Link
            href="/wealth/portfolios/new"
            className={buttonClass("primary")}
          >
            <Plus size={16} />
            New portfolio
          </Link>
        )}
      </div>

      {portfolios.length === 0 ? (
        <p className={emptyStateClass()}>
          No portfolios yet.
        </p>
      ) : (
        <div className="space-y-3">
          {portfolios.map((p) => (
            <Card key={p.id}>
              <div className="flex items-start justify-between gap-4">
                <Link href={`/wealth/portfolios/${p.id}`} className="min-w-0">
                  <p className="font-medium hover:text-accent">{p.name}</p>
                  {p.description && <p className="text-sm text-muted">{p.description}</p>}
                  <p className="mt-1 text-sm text-muted">
                    {p.holdings.length} holding{p.holdings.length !== 1 ? "s" : ""} · {p.currency}
                  </p>
                </Link>
                <div className="flex items-center gap-2">
                  {canWrite && (
                    <>
                      <Link
                        href={`/wealth/portfolios/${p.id}/edit`}
                        className={buttonClass("secondary")}
                      >
                        <Pencil size={16} />
                        Edit
                      </Link>
                      <ConfirmForm
                        action={deletePortfolio.bind(null, p.id)}
                        confirmText={`Delete "${p.name}" and all its holdings and trades? This cannot be undone.`}
                        actionLabel={`Delete "${p.name}"`}
                        className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-danger hover:bg-danger/10"
                        offline={{ entity: "portfolio", entityId: p.id, label: `Delete portfolio: ${p.name}` }}
                      >
                        <Trash2 size={16} />
                        Delete
                      </ConfirmForm>
                    </>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
