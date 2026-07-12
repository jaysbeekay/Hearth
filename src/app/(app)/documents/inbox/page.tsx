import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { getUserPreferences } from "@/lib/userPreferences";
import { InboxReviewClient } from "@/components/InboxReviewClient";

export const metadata: Metadata = { title: "Needs review" };

export default async function InboxPage() {
  const [docs, enabledModules, { dateFormat }] = await Promise.all([
    prisma.inboxDocument.findMany({ orderBy: { uploadedAt: "desc" } }),
    getEnabledModuleKeys(),
    getUserPreferences(),
  ]);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Needs review</h1>
        <p className="text-sm text-muted">
          Documents saved without picking a destination yet. Classify each one, or discard it.
        </p>
      </div>
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
