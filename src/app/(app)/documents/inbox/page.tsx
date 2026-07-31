import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { getUserPreferences } from "@/lib/userPreferences";
import { getDocumentStats } from "@/lib/documents/stats";
import { InboxReviewClient } from "@/components/InboxReviewClient";
import { DocumentsTabs } from "@/components/DocumentsTabs";

export const metadata: Metadata = { title: "Needs review" };

export default async function InboxPage() {
  const [docs, enabledModules, { dateFormat }] = await Promise.all([
    prisma.inboxDocument.findMany({ orderBy: { uploadedAt: "desc" } }),
    getEnabledModuleKeys(),
    getUserPreferences(),
  ]);
  const stats = await getDocumentStats(enabledModules);
  const filedCount = stats.total - stats.needsReview;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Documents</h1>
        <p className="text-sm text-muted">
          Documents saved without picking a destination yet. Classify each one, or discard it.
        </p>
      </div>

      <DocumentsTabs
        active="inbox"
        inboxCount={docs.length}
        filedCount={filedCount}
        allCount={stats.total}
      />

      <InboxReviewClient
        docs={docs.map((d) => ({
          id: d.id,
          filename: d.filename,
          size: d.size,
          uploadedAt: d.uploadedAt.toISOString(),
          downloadHref: `/api/documents/inbox/${d.id}`,
        }))}
        dateFormat={dateFormat}
        inventoryEnabled={enabledModules.has("INVENTORY")}
      />
    </div>
  );
}
