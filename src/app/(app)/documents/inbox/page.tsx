import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { getUserPreferences } from "@/lib/userPreferences";
import { getDocumentStats } from "@/lib/documents/stats";
import { findDocumentsByHash, type DocumentKind } from "@/lib/documents/documentQueries";
import { InboxReviewClient, type DuplicateMatch } from "@/components/InboxReviewClient";
import { DocumentsTabs } from "@/components/DocumentsTabs";

export const metadata: Metadata = { title: "Needs review" };

// Only these three kinds are ones the inbox can natively file into (matches
// classifyInboxDocument's boundary), so only they get a real link + an
// "attach as new version" action — a duplicate match in any other domain is
// still shown, just without an inline action (#206).
const OWNER_HREF: Partial<Record<DocumentKind, (ownerId: string) => string>> = {
  CONTRACT: (id) => `/contracts/${id}`,
  PRODUCT: (id) => `/products/${id}`,
  INVENTORY_ITEM: (id) => `/inventory/${id}`,
};

export default async function InboxPage() {
  const [docs, enabledModules, { dateFormat }] = await Promise.all([
    prisma.inboxDocument.findMany({ orderBy: { uploadedAt: "desc" } }),
    getEnabledModuleKeys(),
    getUserPreferences(),
  ]);
  const stats = await getDocumentStats(enabledModules);
  const filedCount = stats.total - stats.needsReview;

  // Live-recomputed rather than trusting a stored reference — the matched
  // document may have been deleted since this row's status was set (#206).
  const duplicatesByDoc = new Map<string, DuplicateMatch[]>();
  for (const doc of docs) {
    if (doc.status !== "POSSIBLE_DUPLICATE" || !doc.sha256) continue;
    const matches = await findDocumentsByHash(doc.sha256);
    duplicatesByDoc.set(
      doc.id,
      matches.map((m) => ({
        kind: m.kind,
        filename: m.filename,
        ownerHref: m.ownerId && OWNER_HREF[m.kind] ? OWNER_HREF[m.kind]!(m.ownerId) : null,
        ownerId: m.ownerId,
        docId: m.id,
      })),
    );
  }

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
          fromAddress: d.fromAddress,
          guessedType: d.guessedType,
          status: d.status,
          duplicateOf: duplicatesByDoc.get(d.id) ?? [],
        }))}
        dateFormat={dateFormat}
        inventoryEnabled={enabledModules.has("INVENTORY")}
      />
    </div>
  );
}
