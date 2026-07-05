import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { auth } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules/enablement";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { ConfirmForm } from "@/components/ConfirmForm";
import { deletePortfolio } from "@/lib/actions/wealth";

export const metadata: Metadata = { title: "Portfolios" };

export default async function PortfoliosPage() {
  await requireModuleEnabled("WEALTH");
  const session = await auth();

  const portfolios = await prisma.portfolio.findMany({
    where: { createdById: session!.user.id },
    include: { holdings: { include: { _count: { select: { trades: true } } } } },
    orderBy: { name: "asc" },
  });

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/wealth" className="text-sm text-foreground/60 hover:text-foreground">← Back to wealth</Link>
          <h1 className="mt-1 text-2xl font-semibold">Portfolios</h1>
        </div>
        <Link
          href="/wealth/portfolios/new"
          className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
        >
          <Plus size={16} />
          New portfolio
        </Link>
      </div>

      {portfolios.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-foreground/60">
          No portfolios yet.
        </p>
      ) : (
        <div className="space-y-3">
          {portfolios.map((p) => (
            <div key={p.id} className="rounded-xl border border-border bg-surface p-4 md:p-6">
              <div className="flex items-start justify-between gap-4">
                <Link href={`/wealth/portfolios/${p.id}`} className="min-w-0">
                  <p className="font-semibold hover:text-accent">{p.name}</p>
                  {p.description && <p className="text-sm text-foreground/60">{p.description}</p>}
                  <p className="mt-1 text-sm text-foreground/50">
                    {p.holdings.length} holding{p.holdings.length !== 1 ? "s" : ""} · {p.currency}
                  </p>
                </Link>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/wealth/portfolios/${p.id}/edit`}
                    className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <Pencil size={16} />
                    Edit
                  </Link>
                  <ConfirmForm
                    action={deletePortfolio.bind(null, p.id)}
                    confirmText={`Delete "${p.name}" and all its holdings and trades? This cannot be undone.`}
                    className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-danger hover:bg-danger/10"
                  >
                    <Trash2 size={16} />
                    Delete
                  </ConfirmForm>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
