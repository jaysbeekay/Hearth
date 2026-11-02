import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { canWrite as sessionCanWrite } from "@/lib/readOnly";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { getDocumentStats } from "@/lib/documents/stats";
import { findImportDuplicates, MAX_PENDING_IMPORTS } from "@/lib/mcp/imports";
import { DocumentsTabs } from "@/components/DocumentsTabs";
import { McpImportReviewClient, type ImportProposalView } from "@/components/McpImportReviewClient";
import { PageShell } from "@/components/ui/PageShell";

export const metadata: Metadata = { title: "Imports" };

// #529 — pending records proposed over MCP. The queue is capped at
// MAX_PENDING_IMPORTS, so loading every pending row is bounded.
export default async function McpImportsPage() {
  const session = await auth();
  const canWrite = sessionCanWrite(session);

  const [rows, enabledModules] = await Promise.all([
    prisma.mcpImportProposal.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      take: MAX_PENDING_IMPORTS,
    }),
    getEnabledModuleKeys(),
  ]);
  const [stats, duplicates] = await Promise.all([getDocumentStats(enabledModules), findImportDuplicates(rows)]);

  const proposals: ImportProposalView[] = rows.map((row) => {
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(row.data) as Record<string, unknown>;
    } catch {
      // Shown with no fields; approving reports it as unreadable.
    }
    return {
      id: row.id,
      kind: row.kind,
      summary: row.summary,
      tokenLabel: row.tokenLabel,
      createdAt: row.createdAt.toISOString(),
      data,
      duplicates: duplicates.get(row.id) ?? [],
    };
  });

  return (
    <PageShell width="list">
      <div>
        <h1 className="text-2xl font-medium">Documents</h1>
        <p className="text-sm text-muted">
          Records an MCP agent proposed importing. Nothing is saved until you approve it.
        </p>
      </div>

      <DocumentsTabs
        active="imports"
        inboxCount={stats.inboxCount}
        filedCount={stats.total - stats.inboxCount}
        allCount={stats.total}
        importsCount={rows.length}
      />

      <McpImportReviewClient proposals={proposals} canWrite={canWrite} />
    </PageShell>
  );
}
